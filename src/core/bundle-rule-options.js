import {
    buildCustomBundleMaps,
    getCustomDomainBundleEntryOwners,
    getRootDomain,
    resolveGroupingForHostname,
} from "./grouping.js";
import { isWebUrl, safeParseUrl } from "./urls.js";
import { canonicalizeDomainEntry } from "../settings/validation.js";

const unsupportedOptions = () => ({
    supported: false,
    hostname: "",
    rootDomain: "",
    hostOptions: [],
    pathOptions: [],
});

export function buildBundleRuleEntry({ hostname, pathPrefix } = {}) {
    const path = String(pathPrefix ?? "");
    if (path && !path.startsWith("/")) {
        return { valid: false, error: "Path scope must start with a slash." };
    }
    if (/[?#]/.test(path)) {
        return { valid: false, error: "Queries and fragments are not supported in bundle rules." };
    }

    const normalized = canonicalizeDomainEntry(`${String(hostname ?? "").trim()}${path}`);
    if (!normalized.valid) {
        return { valid: false, error: normalized.error || "Invalid bundle rule." };
    }
    return { valid: true, canonicalEntry: normalized.canonicalEntry };
}

export function getBundleRuleOptions({ url, commonMultipartSuffixes } = {}) {
    const parsedUrl = safeParseUrl(url);
    if (!isWebUrl(parsedUrl)) return unsupportedOptions();

    const hostname = parsedUrl.hostname.toLowerCase();
    const rootDomain = getRootDomain(hostname, commonMultipartSuffixes)?.rootDomain ?? "";
    if (!hostname || !rootDomain) return unsupportedOptions();

    const hostOptions = [];
    if (hostname !== rootDomain) {
        hostOptions.push({ value: hostname, label: hostname });
    }
    hostOptions.push({ value: rootDomain, label: `${rootDomain} and its subdomains` });

    const pathOptions = [{ value: "", label: "All paths" }];
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const prefixes = [];
    for (let index = 0; index < segments.length; index += 1) {
        const candidate = `/${segments.slice(0, index + 1).join("/")}`;
        const built = buildBundleRuleEntry({ hostname, pathPrefix: candidate });
        if (!built.valid) continue;
        const canonicalPath = built.canonicalEntry.slice(hostname.length);
        if (canonicalPath && prefixes.at(-1) !== canonicalPath) prefixes.push(canonicalPath);
    }
    prefixes.forEach((value, index) => {
        pathOptions.push({
            value,
            label: index === prefixes.length - 1
                ? "This path and descendants"
                : `${value} and descendants`,
        });
    });

    return { supported: true, hostname, rootDomain, hostOptions, pathOptions };
}

function resolveForUrl(parsedUrl, settings, customDomainGroups) {
    return resolveGroupingForHostname({
        url: parsedUrl.href,
        hostname: parsedUrl.hostname,
        pathname: parsedUrl.pathname,
        commonMultipartSuffixes: settings?.commonMultipartSuffixes,
        excludedFromRootCollapse: settings?.excludedFromRootCollapse,
        ignoredHostnames: settings?.ignoredHostnames,
        customBundleMaps: buildCustomBundleMaps(customDomainGroups),
        managedPrefix: settings?.autoGroupPrefix,
    });
}

export function previewBundleRule({ url, settings, bundleIndex, entry } = {}) {
    const customDomainGroups = Array.isArray(settings?.customDomainGroups)
        ? settings.customDomainGroups
        : [];
    const ownership = getCustomDomainBundleEntryOwners(customDomainGroups, entry);
    const parsedUrl = safeParseUrl(url);
    if (!isWebUrl(parsedUrl)) {
        return { ownership, beforeGrouping: null, afterGrouping: null };
    }

    const beforeGrouping = resolveForUrl(parsedUrl, settings, customDomainGroups);
    const normalized = canonicalizeDomainEntry(entry);
    if (!normalized.valid || !Number.isInteger(bundleIndex) || !customDomainGroups[bundleIndex]) {
        return { ownership, beforeGrouping, afterGrouping: null };
    }

    const hypotheticalGroups = customDomainGroups.map((group, index) => {
        if (index !== bundleIndex) return group;
        const domains = Array.isArray(group?.domains) ? group.domains : [];
        return { ...group, domains: [...domains, normalized.canonicalEntry] };
    });
    const afterGrouping = resolveForUrl(parsedUrl, settings, hypotheticalGroups);
    return { ownership, beforeGrouping, afterGrouping };
}
