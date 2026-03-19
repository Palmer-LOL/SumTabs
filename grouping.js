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

export function buildCustomBundleMaps(customDomainGroups) {
    const exactHostnameToBundleTitle = new Map();
    const rootDomainToBundleTitle = new Map();

    for (const group of customDomainGroups ?? []) {
        const title = String(group?.title ?? "").trim();
        if (!title || !Array.isArray(group?.domains)) continue;

        for (const domain of group.domains) {
            const normalizedDomain = toLowerString(domain);
            if (!normalizedDomain) continue;

            exactHostnameToBundleTitle.set(normalizedDomain, title);
            rootDomainToBundleTitle.set(normalizedDomain, title);
        }
    }

    return { exactHostnameToBundleTitle, rootDomainToBundleTitle };
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
    hostname,
    commonMultipartSuffixes,
    excludedFromRootCollapse,
    customBundleMaps,
    managedPrefix,
}) {
    const normalizedHostname = toLowerString(hostname);
    const prefix = String(managedPrefix ?? "");
    const { rootDomain, matchedSuffix } = getRootDomain(normalizedHostname, commonMultipartSuffixes);

    const excludedHostnames = excludedFromRootCollapse instanceof Set
        ? excludedFromRootCollapse
        : new Set((excludedFromRootCollapse ?? []).map((value) => toLowerString(value)).filter(Boolean));

    const exactHostnameToBundleTitle = customBundleMaps?.exactHostnameToBundleTitle;
    const rootDomainToBundleTitle = customBundleMaps?.rootDomainToBundleTitle;

    const isExactHostSeparated = excludedHostnames.has(normalizedHostname);
    // Exact-host separation only changes the default fallback key.
    // Custom bundles still resolve by exact hostname first, then by the registrable/root domain.
    const defaultGroupingKey = isExactHostSeparated ? normalizedHostname : rootDomain;
    const bundleInheritanceKey = rootDomain;

    // An exact bundle match is the most specific result and wins before inherited root-domain bundles.
    const exactBundleTitle = getMapValue(exactHostnameToBundleTitle, normalizedHostname);
    if (exactBundleTitle) {
        return {
            hostname: normalizedHostname,
            groupKey: normalizedHostname,
            identity: `${prefix}${exactBundleTitle}`,
            reason: "custom-bundle-grouping",
            matchedSuffix,
            matchedExactHostname: normalizedHostname,
            matchedCustomBundleTitle: exactBundleTitle,
            displayGroupingLabel: exactBundleTitle,
        };
    }

    // If there is no exact bundle, inherit from the root-domain bundle even when default grouping stays host-specific.
    const rootBundleTitle = getMapValue(rootDomainToBundleTitle, bundleInheritanceKey);
    if (rootBundleTitle) {
        return {
            hostname: normalizedHostname,
            groupKey: bundleInheritanceKey,
            identity: `${prefix}${rootBundleTitle}`,
            reason: "custom-bundle-grouping",
            matchedSuffix,
            matchedExactHostname: isExactHostSeparated ? normalizedHostname : null,
            matchedCustomBundleTitle: rootBundleTitle,
            displayGroupingLabel: rootBundleTitle,
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
