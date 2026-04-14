function toLowerString(value) {
    return String(value ?? "").trim().toLowerCase();
}

function toLookupMap(source) {
    if (source instanceof Map) return source;
    if (!source || typeof source !== "object") return new Map();
    return new Map(Object.entries(source));
}

function getMapValue(mapLike, key) {
    const normalizedKey = toLowerString(key);
    if (!normalizedKey) return null;

    const lookup = toLookupMap(mapLike);
    const value = lookup.get(normalizedKey);
    return value == null ? null : value;
}

function normalizePathPrefix(pathLike) {
    let path = `/${String(pathLike ?? "")}`;
    path = path.replace(/\/+/g, "/");

    if (path.endsWith("/*")) {
        path = path.slice(0, -2) || "/";
    }

    while (path.length > 1 && path.endsWith("/")) {
        path = path.slice(0, -1);
    }

    return path;
}

export function parseCustomDomainRule(domainEntry) {
    const raw = String(domainEntry ?? "").trim();
    const result = {
        raw,
        hostname: "",
        pathPrefix: null,
        matchMode: "host_only",
        valid: false,
        error: null,
    };

    if (!raw) {
        result.error = "Domain entry is empty.";
        return result;
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        result.error = "Protocols are not allowed.";
        return result;
    }

    const slashIndex = raw.indexOf("/");
    const hostnamePart = slashIndex === -1 ? raw : raw.slice(0, slashIndex);
    const normalizedHostname = toLowerString(hostnamePart);

    if (!normalizedHostname) {
        result.error = "Hostname is required.";
        return result;
    }

    result.hostname = normalizedHostname;

    if (slashIndex === -1) {
        result.valid = true;
        return result;
    }

    const rawPath = raw.slice(slashIndex + 1);
    const normalizedPathPrefix = normalizePathPrefix(rawPath);

    if (normalizedPathPrefix && normalizedPathPrefix !== "/") {
        result.pathPrefix = normalizedPathPrefix;
        result.matchMode = "host_path_prefix";
    }

    result.valid = true;
    return result;
}

export function parseCustomDomainGroups(customDomainGroups) {
    const parsedGroups = [];

    for (const group of customDomainGroups ?? []) {
        const title = String(group?.title ?? "").trim();
        if (!title || !Array.isArray(group?.domains)) continue;

        const parsedRules = group.domains.map((domain) => parseCustomDomainRule(domain));
        parsedGroups.push({
            title,
            parsedRules,
        });
    }

    return parsedGroups;
}

export function buildCustomBundleMaps(customDomainGroups) {
    const exactHostnameToBundleRules = new Map();
    const rootDomainToBundleRules = new Map();

    for (const group of parseCustomDomainGroups(customDomainGroups)) {
        for (const rule of group.parsedRules) {
            if (!rule.valid) continue;

            const exactRules = exactHostnameToBundleRules.get(rule.hostname) ?? [];
            exactRules.push({ title: group.title, rule });
            exactHostnameToBundleRules.set(rule.hostname, exactRules);

            const rootRules = rootDomainToBundleRules.get(rule.hostname) ?? [];
            rootRules.push({ title: group.title, rule });
            rootDomainToBundleRules.set(rule.hostname, rootRules);
        }
    }

    return { exactHostnameToBundleRules, rootDomainToBundleRules };
}

// Matcher behavior is intentionally strict to prevent prefix false-positives:
// 1) Hostname must match exactly before any path checks.
// 2) If rule.pathPrefix exists, match only when pathname is exactly rule.pathPrefix
//    or starts with `${rule.pathPrefix}/` (so `/codexx` does not match `/codex`).
// 3) Matching uses URL.pathname only; query string and hash are ignored by design.
export function matchesParsedUrlAgainstRule(parsedUrl, rule) {
    if (!parsedUrl || !rule?.hostname) return false;

    const parsedHostname = toLowerString(parsedUrl.hostname);
    if (!parsedHostname || parsedHostname !== rule.hostname) return false;

    if (!rule.pathPrefix) return true;

    const pathname = normalizePathPrefix(parsedUrl.pathname || "/");
    if (pathname === rule.pathPrefix) return true;

    return pathname.startsWith(`${rule.pathPrefix}/`);
}

function findWinningBundleRule(ruleEntries, parsedUrl) {
    if (!Array.isArray(ruleEntries) || ruleEntries.length === 0) return null;

    const candidates = [];
    for (let idx = 0; idx < ruleEntries.length; idx += 1) {
        const entry = ruleEntries[idx];
        const rule = entry?.rule;
        if (!matchesParsedUrlAgainstRule(parsedUrl, rule)) continue;

        candidates.push({
            idx,
            title: entry.title,
            hostnameLen: rule.hostname.length,
            hasPathRule: Boolean(rule.pathPrefix),
            pathLen: rule.pathPrefix ? rule.pathPrefix.length : -1,
            rule,
        });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
        // Precedence for overlapping custom bundle matches:
        // 1) Longer hostname specificity (exact-host map still compares equally here)
        // 2) Path rule over host-only rule
        //    Example: chatgpt.com vs chatgpt.com/codex -> /codex rule wins for /codex paths.
        // 3) Longer pathPrefix among path rules
        //    Example: chatgpt.com/codex vs chatgpt.com/codex/agents -> /codex/agents wins.
        // 4) Stable declaration-order fallback (earlier declared rule wins ties)
        if (a.hostnameLen !== b.hostnameLen) return b.hostnameLen - a.hostnameLen;
        if (a.hasPathRule !== b.hasPathRule) return Number(b.hasPathRule) - Number(a.hasPathRule);
        if (a.pathLen !== b.pathLen) return b.pathLen - a.pathLen;
        return a.idx - b.idx;
    });

    return candidates[0];
}

export function getRootDomain(hostname, commonMultipartSuffixes) {
    const normalizedHostname = toLowerString(hostname);
    if (!normalizedHostname) return "";

    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHostname);
    if (isIPv4) {
        return {
            hostname: normalizedHostname,
            rootDomain: normalizedHostname,
            matchedSuffix: null,
        };
    }

    const parts = normalizedHostname.split(".").filter(Boolean);
    if (parts.length <= 2) {
        return {
            hostname: normalizedHostname,
            rootDomain: normalizedHostname,
            matchedSuffix: null,
        };
    }

    const suffixes = commonMultipartSuffixes instanceof Set
        ? commonMultipartSuffixes
        : new Set((commonMultipartSuffixes ?? []).map((suffix) => toLowerString(suffix)).filter(Boolean));

    const last2 = parts.slice(-2).join(".");
    const last3 = parts.slice(-3).join(".");

    if (suffixes.has(last2)) {
        return {
            hostname: normalizedHostname,
            rootDomain: last3,
            matchedSuffix: last2,
        };
    }

    return {
        hostname: normalizedHostname,
        rootDomain: last2,
        matchedSuffix: null,
    };
}

export function getDomainWideSeparationRule(hostname, commonMultipartSuffixes) {
    const normalizedHostname = toLowerString(hostname);
    if (!normalizedHostname) return null;

    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHostname);
    if (isIPv4) return null;

    const parts = normalizedHostname.split(".").filter(Boolean);
    if (parts.length < 2) return null;

    const { rootDomain, matchedSuffix } = getRootDomain(normalizedHostname, commonMultipartSuffixes);
    const token = matchedSuffix || rootDomain;
    if (!token || !token.includes(".")) return null;

    return {
        token,
        label: `Separate all *.${token} subdomains`,
        affectsHostname: matchedSuffix === token,
    };
}

export function resolveGroupingForHostname({
    url,
    hostname,
    pathname,
    parsedUrl,
    commonMultipartSuffixes,
    excludedFromRootCollapse,
    customBundleMaps,
    managedPrefix,
}) {
    const normalizedHostname = toLowerString(hostname);
    const prefix = String(managedPrefix ?? "");
    const { rootDomain, matchedSuffix } = getRootDomain(normalizedHostname, commonMultipartSuffixes);
    let normalizedParsedUrl = parsedUrl instanceof URL ? parsedUrl : null;
    if (!normalizedParsedUrl && typeof url === "string" && url.trim()) {
        try {
            normalizedParsedUrl = new URL(url);
        } catch {}
    }
    if (!normalizedParsedUrl && normalizedHostname) {
        const normalizedPathname = normalizePathPrefix(pathname || "/");
        normalizedParsedUrl = new URL(`https://${normalizedHostname}${normalizedPathname}`);
    }

    const excludedHostnames = excludedFromRootCollapse instanceof Set
        ? excludedFromRootCollapse
        : new Set((excludedFromRootCollapse ?? []).map((value) => toLowerString(value)).filter(Boolean));

    const exactHostnameToBundleRules = customBundleMaps?.exactHostnameToBundleRules;
    const rootDomainToBundleRules = customBundleMaps?.rootDomainToBundleRules;

    const isExactHostSeparated = excludedHostnames.has(normalizedHostname);
    // Exact-host separation only changes the default fallback key.
    // Custom bundles still resolve by exact hostname first, then by the registrable/root domain.
    const defaultGroupingKey = isExactHostSeparated ? normalizedHostname : rootDomain;
    const bundleInheritanceKey = rootDomain;

    // An exact bundle match is the most specific result and wins before inherited root-domain bundles.
    const exactRuleEntries = getMapValue(exactHostnameToBundleRules, normalizedHostname);
    const exactWinningRule = findWinningBundleRule(exactRuleEntries, normalizedParsedUrl);
    if (exactWinningRule) {
        return {
            hostname: normalizedHostname,
            groupKey: normalizedHostname,
            identity: `${prefix}${exactWinningRule.title}`,
            reason: "custom-bundle-grouping",
            matchedSuffix,
            matchedExactHostname: exactWinningRule.rule.hostname,
            matchedCustomBundleTitle: exactWinningRule.title,
            displayGroupingLabel: exactWinningRule.title,
        };
    }

    // If there is no exact bundle, inherit from the root-domain bundle even when default grouping stays host-specific.
    // Root-domain inheritance should evaluate rules as if the current URL were on the root hostname so
    // host-only rules like "example.com" still match subdomains like "foo.example.com".
    let rootInheritanceParsedUrl = normalizedParsedUrl;
    if (normalizedParsedUrl && bundleInheritanceKey) {
        rootInheritanceParsedUrl = new URL(normalizedParsedUrl.toString());
        rootInheritanceParsedUrl.hostname = bundleInheritanceKey;
    }

    // Inherited root-domain matching still uses full precedence logic within root-domain rules.
    const rootRuleEntries = getMapValue(rootDomainToBundleRules, bundleInheritanceKey);
    const rootWinningRule = findWinningBundleRule(rootRuleEntries, rootInheritanceParsedUrl);
    if (rootWinningRule) {
        return {
            hostname: normalizedHostname,
            groupKey: bundleInheritanceKey,
            identity: `${prefix}${rootWinningRule.title}`,
            reason: "custom-bundle-grouping",
            matchedSuffix,
            matchedExactHostname: rootWinningRule.rule.hostname,
            matchedCustomBundleTitle: rootWinningRule.title,
            displayGroupingLabel: rootWinningRule.title,
        };
    }

    if (isExactHostSeparated) {
        return {
            hostname: normalizedHostname,
            groupKey: defaultGroupingKey,
            identity: `${prefix}${normalizedHostname}`,
            reason: "exact-host-separation",
            matchedSuffix,
            matchedExactHostname: normalizedHostname,
            matchedCustomBundleTitle: null,
            displayGroupingLabel: normalizedHostname,
        };
    }

    if (matchedSuffix) {
        return {
            hostname: normalizedHostname,
            groupKey: defaultGroupingKey,
            identity: `${prefix}${rootDomain}`,
            reason: "multipart-suffix-separation",
            matchedSuffix,
            matchedExactHostname: null,
            matchedCustomBundleTitle: null,
            displayGroupingLabel: rootDomain,
        };
    }

    return {
        hostname: normalizedHostname,
        groupKey: defaultGroupingKey,
        identity: `${prefix}${rootDomain}`,
        reason: "default-root-domain-grouping",
        matchedSuffix: null,
        matchedExactHostname: null,
        matchedCustomBundleTitle: null,
        displayGroupingLabel: rootDomain,
    };
}
