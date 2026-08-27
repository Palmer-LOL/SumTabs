import { getCustomDomainBundleEntryConflicts, parseCustomDomainRule } from "./grouping.js";

export const MIN_GROUPING_THRESHOLD = 2;
export const VALID_GROUP_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

const BOOLEAN_SETTING_KEYS = [
    "collapseOtherGroupsOnNavEvents",
    "keepManagedGroupsAtFront",
    "ungroupSingletonManagedGroups",
    "ignoreInitialTabUrlForGrouping",
    "ignoreInitialTabUrlForEnforcement",
];
const HOSTNAME_LIST_SETTING_KEYS = [
    "commonMultipartSuffixes",
    "excludedFromRootCollapse",
    "ignoredHostnames",
];

export function splitNonEmptyLines(text) {
    return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function domainsToLines(domains) {
    return (domains || [])
        .map((domain) => String(domain).trim().toLowerCase())
        .filter(Boolean)
        .join("\n");
}

export function arrayToLines(values) {
    return (values || []).join("\n");
}

export function normalizeHostname(hostname) {
    const candidate = String(hostname ?? "").trim().toLowerCase();
    if (!candidate) return { valid: false, error: "Hostname is required." };
    if (/^(?:https?|ftp)\//i.test(candidate)) {
        return { valid: false, error: "The protocol appears to be malformed." };
    }
    if (/[\s/@?#%*]/.test(candidate)) {
        return { valid: false, error: "Hostname contains unsupported characters." };
    }
    if (candidate.includes(":") && !(candidate.startsWith("[") && candidate.endsWith("]"))) {
        return { valid: false, error: "Ports are not supported." };
    }

    try {
        const parsedUrl = new URL(`http://${candidate}`);
        if (!parsedUrl.hostname || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
            return { valid: false, error: "Hostname is not valid." };
        }
        return { valid: true, hostname: parsedUrl.hostname.toLowerCase() };
    } catch {
        return { valid: false, error: "Hostname is not valid." };
    }
}

export function canonicalizeDomainEntry(rawEntry) {
    const parsed = parseCustomDomainRule(rawEntry);
    if (!parsed.valid) return { valid: false, raw: parsed.raw, error: parsed.error };

    const normalizedHostname = normalizeHostname(parsed.hostname);
    if (!normalizedHostname.valid) {
        return { valid: false, raw: parsed.raw, error: normalizedHostname.error };
    }

    return {
        valid: true,
        canonicalEntry: parsed.pathPrefix
            ? `${normalizedHostname.hostname}${parsed.pathPrefix}`
            : normalizedHostname.hostname,
        hostname: normalizedHostname.hostname,
        pathPrefix: parsed.pathPrefix,
    };
}

export function parseDomainsTextarea(text) {
    const seen = new Set();
    const validDomains = [];
    const invalidEntries = [];

    for (const raw of splitNonEmptyLines(text)) {
        const normalized = canonicalizeDomainEntry(raw);
        if (!normalized.valid) {
            invalidEntries.push({ raw, error: normalized.error || "Invalid domain rule." });
            continue;
        }

        if (seen.has(normalized.canonicalEntry)) continue;
        seen.add(normalized.canonicalEntry);
        validDomains.push(normalized.canonicalEntry);
    }

    return {
        validDomains,
        invalidEntries,
        canonicalText: validDomains.join("\n"),
    };
}

export function parseHostnameRulesTextarea(text) {
    const seen = new Set();
    const validHostnames = [];
    const invalidEntries = [];

    for (const raw of splitNonEmptyLines(text)) {
        const normalized = canonicalizeDomainEntry(raw);
        if (!normalized.valid) {
            invalidEntries.push({ raw, error: normalized.error || "Invalid hostname." });
            continue;
        }

        if (normalized.pathPrefix) {
            invalidEntries.push({ raw, error: "Path rules are not supported in this list." });
            continue;
        }

        if (seen.has(normalized.hostname)) continue;
        seen.add(normalized.hostname);
        validHostnames.push(normalized.hostname);
    }

    return {
        validHostnames,
        invalidEntries,
        canonicalText: validHostnames.join("\n"),
    };
}

export function validateImportedSettings(settings, requiredManagedGroupPrefix) {
    const validatedSettings = structuredClone(settings);

    if (settings.autoGroupPrefix !== requiredManagedGroupPrefix) {
        throw new Error("The backup does not contain the required SumTabs managed-group prefix.");
    }

    if (Object.hasOwn(settings, "minTabsToGroup")
        && (!Number.isInteger(settings.minTabsToGroup)
            || settings.minTabsToGroup < MIN_GROUPING_THRESHOLD)) {
        throw new Error(`The backup setting “minTabsToGroup” must be a whole number of ${MIN_GROUPING_THRESHOLD} or greater.`);
    }

    for (const key of BOOLEAN_SETTING_KEYS) {
        if (!Object.hasOwn(settings, key)) continue;
        if (typeof settings[key] !== "boolean") {
            throw new Error(`The backup setting “${key}” must be true or false.`);
        }
    }

    for (const key of HOSTNAME_LIST_SETTING_KEYS) {
        if (!Object.hasOwn(settings, key)) continue;
        if (!Array.isArray(settings[key]) || settings[key].some((value) => typeof value !== "string")) {
            throw new Error(`The backup setting “${key}” must be an array of hostnames.`);
        }
        const parsed = parseHostnameRulesTextarea(settings[key].join("\n"));
        if (parsed.invalidEntries.length) {
            throw new Error(`The backup setting “${key}” contains an invalid hostname.`);
        }
        validatedSettings[key] = parsed.validHostnames;
    }

    if (Object.hasOwn(settings, "customDomainGroups")) {
        const groups = coerceGroupsFromJson(settings.customDomainGroups);
        for (const [index, group] of groups.entries()) {
            if (!group.title.trim()) {
                throw new Error(`The backup setting “customDomainGroups” has no title for bundle ${index + 1}.`);
            }
            if (parseDomainsTextarea(group.domainsText).invalidEntries.length) {
                throw new Error(`The backup setting “customDomainGroups” contains an invalid rule in bundle ${index + 1}.`);
            }
        }
        if (getCustomDomainBundleEntryConflicts(groupsForPersistence(groups)).length) {
            throw new Error("The backup setting “customDomainGroups” contains a domain rule used by more than one bundle.");
        }
    }

    // Return a copy of the entire payload so settings from newer versions are
    // retained, while every setting understood by this version is validated.
    return validatedSettings;
}

export function normalizeStoredGroups(groups) {
    if (!Array.isArray(groups)) return [];

    return groups.map((group) => {
        const color = String(group?.color ?? "").trim().toLowerCase();
        const domainsText = domainsToLines(Array.isArray(group?.domains) ? group.domains : []);
        return {
            title: String(group?.title ?? "").trim(),
            domainsText,
            color: VALID_GROUP_COLORS.has(color) ? color : "",
        };
    });
}

export function groupRawDomains(group) {
    return splitNonEmptyLines(group?.domainsText ?? "");
}

export function groupsForRawJson(customGroupsState) {
    return (customGroupsState ?? []).map((group) => ({
        title: String(group?.title ?? ""),
        domains: groupRawDomains(group),
        ...(VALID_GROUP_COLORS.has(String(group?.color ?? "")) ? { color: group.color } : {}),
    }));
}

export function groupsForPersistence(customGroupsState) {
    return (customGroupsState ?? []).map((group) => {
        const parsedDomains = parseDomainsTextarea(group?.domainsText ?? "");
        const color = String(group?.color ?? "").trim().toLowerCase();
        return {
            title: String(group?.title ?? "").trim(),
            domains: parsedDomains.validDomains,
            ...(VALID_GROUP_COLORS.has(color) ? { color } : {}),
        };
    });
}

export function coerceGroupsFromJson(value) {
    if (!Array.isArray(value)) throw new Error("The top-level JSON value must be an array.");

    return value.map((group, index) => {
        if (!group || typeof group !== "object" || Array.isArray(group)) {
            throw new Error(`Bundle ${index + 1} must be an object.`);
        }
        if (typeof group.title !== "string") {
            throw new Error(`Bundle ${index + 1} must have a string title.`);
        }
        if (!Array.isArray(group.domains) || group.domains.some((domain) => typeof domain !== "string")) {
            throw new Error(`Bundle ${index + 1} must have a domains array containing only strings.`);
        }

        const color = group.color == null ? "" : String(group.color).trim().toLowerCase();
        if (color && !VALID_GROUP_COLORS.has(color)) {
            throw new Error(`Bundle ${index + 1} has an unsupported color.`);
        }

        return {
            title: group.title,
            domainsText: group.domains.join("\n"),
            color,
        };
    });
}
