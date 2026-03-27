export const DEFAULTS = {
    autoGroupPrefix: "∑ ",
    collapseOtherGroupsOnNavEvents: true,
    ungroupSingletonManagedGroups: false,
    keepManagedGroupsAtFront: true,

    ignoreInitialTabUrlForGrouping: true,
    ignoreInitialTabUrlForEnforcement: true,
    createPinnedTabsOnNewWindow: false,
    enforcePinnedTabs: false,
    pinnedTabs: [],

    // Storage key kept for backward compatibility: domain-wide subdomain separation rules
    commonMultipartSuffixes: [
        "co.uk","org.uk","ac.uk","gov.uk",
        "com.au","net.au","org.au",
        "co.nz","org.nz",
        "co.jp","ne.jp","or.jp",
        "com.br","com.mx",
    ],

    // Storage key kept for backward compatibility: exact-host separation rules
    excludedFromRootCollapse: [
        // "docs.google.com",
    ],

    customDomainGroups: [
        // { title: "Chess", domains: ["chess.com", "chessly.com"], color: "purple" }
    ],
};
