export const DEFAULTS = {
    autoGroupPrefix: "∑ ",
    collapseOtherGroupsOnNavEvents: true,

    ignoreInitialTabUrlForGrouping: true,
    ignoreInitialTabUrlForEnforcement: true,

    // editable “mini PSL”
    commonMultipartSuffixes: [
        "co.uk","org.uk","ac.uk","gov.uk",
        "com.au","net.au","org.au",
        "co.nz","org.nz",
        "co.jp","ne.jp","or.jp",
        "com.br","com.mx",
    ],

    excludedFromRootCollapse: [
        // "docs.google.com",
    ],

    customDomainGroups: [
        // { title: "Chess", domains: ["chess.com", "chessly.com"], color: "purple" }
    ],
};
