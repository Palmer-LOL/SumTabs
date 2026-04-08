export const DEFAULTS = {
    autoGroupPrefix: "∑ ",
    collapseOtherGroupsOnNavEvents: true,
    ungroupSingletonManagedGroups: false,

    ignoreInitialTabUrlForGrouping: true,
    ignoreInitialTabUrlForEnforcement: true,

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
