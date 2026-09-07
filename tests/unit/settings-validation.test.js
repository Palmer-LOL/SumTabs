import { describe, expect, it } from "vitest";
import {
    coerceGroupsFromJson,
    domainsToLines,
    groupsForPersistence,
    groupsForRawJson,
    normalizeHostname,
    normalizeStoredGroups,
    parseDomainsTextarea,
    parseHostnameRulesTextarea,
    splitNonEmptyLines,
    validateImportedSettings,
} from "../../src/settings/validation.js";
import { DEFAULTS } from "../../src/core/defaults.js";

describe("settings hostname normalization", () => {
    it.each([
        ["example.com", { valid: true, hostname: "example.com" }],
        [" EXAMPLE.com ", { valid: true, hostname: "example.com" }],
        ["docs.example.com", { valid: true, hostname: "docs.example.com" }],
        ["192.168.0.1", { valid: true, hostname: "192.168.0.1" }],
        ["[2001:db8::1]", { valid: true, hostname: "[2001:db8::1]" }],
        ["", { valid: false, error: "Hostname is required." }],
        ["https://example.com", { valid: false, error: "Hostname contains unsupported characters." }],
        ["example.com/path", { valid: false, error: "Hostname contains unsupported characters." }],
        ["example.com:443", { valid: false, error: "Ports are not supported." }],
        ["bad host.example", { valid: false, error: "Hostname contains unsupported characters." }],
        ["*.example.com", { valid: false, error: "Hostname contains unsupported characters." }],
        ["[]", { valid: false, error: "Hostname is not valid." }],
    ])("normalizes or rejects %s", (input, expected) => {
        expect(normalizeHostname(input)).toMatchObject(expected);
    });
});

describe("settings textarea parsing", () => {
    it("splits non-empty lines with whitespace removed", () => {
        expect(splitNonEmptyLines(" example.com \n\nDocs.Example.com\r\n ")).toEqual(["example.com", "Docs.Example.com"]);
    });

    it("parses hostname-only rules with blank lines ignored, case normalized, duplicates removed, and invalid entries retained", () => {
        const parsed = parseHostnameRulesTextarea(" Example.com \nexample.com\ndocs.example.com\nchatgpt.com/codex\nbad host");
        expect(parsed.validHostnames).toEqual(["example.com", "docs.example.com"]);
        expect(parsed.canonicalText).toBe("example.com\ndocs.example.com");
        expect(parsed.invalidEntries).toEqual([
            { raw: "chatgpt.com/codex", error: "Path rules are not supported in this list." },
            { raw: "bad host", error: "Hostname contains unsupported characters." },
        ]);
    });

    it("parses custom bundle domain/path rules with canonical path-boundary spellings and duplicate removal", () => {
        const parsed = parseDomainsTextarea(" Example.com \nCHATGPT.com/Codex/*\nchatgpt.com//codex///\nhttps://bad.example\nbad host");
        expect(parsed.validDomains).toEqual(["example.com", "chatgpt.com/codex"]);
        expect(parsed.canonicalText).toBe("example.com\nchatgpt.com/codex");
        expect(parsed.invalidEntries).toEqual([
            { raw: "https://bad.example", error: "Protocols are not allowed." },
            { raw: "bad host", error: "Hostname contains unsupported characters." },
        ]);
    });

    it("formats stored arrays as deterministic lower-case lines", () => {
        expect(domainsToLines([" Example.com ", "", "Docs.Example.com"])).toBe("example.com\ndocs.example.com");
    });
});

describe("custom bundle normalization and persistence helpers", () => {
    it("normalizes stored groups without requiring DOM, chrome, or mutable UI state", () => {
        expect(normalizeStoredGroups([
            { title: " News ", domains: ["NYTimes.com", "theatlantic.com/culture/*"], color: " BLUE " },
            { title: null, domains: "not-array", color: "chartreuse" },
        ])).toEqual([
            { title: "News", domainsText: "nytimes.com\ntheatlantic.com/culture/*", color: "blue" },
            { title: "", domainsText: "", color: "" },
        ]);
    });

    it("builds raw JSON state from editor groups while preserving raw domain lines and supported colors", () => {
        expect(groupsForRawJson([
            { title: "Bundle", domainsText: "Example.com\n\nChatGPT.com/Codex", color: "green" },
            { title: "No Color", domainsText: "example.org", color: "unsupported" },
        ])).toEqual([
            { title: "Bundle", domains: ["Example.com", "ChatGPT.com/Codex"], color: "green" },
            { title: "No Color", domains: ["example.org"] },
        ]);
    });

    it("builds persistence payloads with trimmed titles, canonical domains, duplicate removal, and supported colors", () => {
        expect(groupsForPersistence([
            { title: " Bundle ", domainsText: "Example.com\nchatgpt.com/codex/*\nchatgpt.com/codex", color: " ORANGE " },
        ])).toEqual([
            { title: "Bundle", domains: ["example.com", "chatgpt.com/codex"], color: "orange" },
        ]);
    });

    it("allows an empty domain list and missing title at coercion time because UI validation handles those", () => {
        expect(coerceGroupsFromJson([{ title: "", domains: [], color: "" }])).toEqual([{ title: "", domainsText: "", color: "" }]);
    });
});

describe("raw JSON coercion", () => {
    it("preserves unknown nested properties through raw JSON apply and persistence", () => {
        const raw = [{ title: "Renamed", domains: ["chatgpt.com"], color: "purple", future: { keep: true } }];
        const coerced = coerceGroupsFromJson(raw);
        expect(coerced).toEqual([
            { title: "Renamed", domainsText: "chatgpt.com", color: "purple", future: { keep: true } },
        ]);
        expect(groupsForPersistence(coerced)).toEqual(raw);
    });

    it.each([
        ["not array", "The top-level JSON value must be an array."],
        [[null], "Bundle 1 must be an object."],
        [[[]], "Bundle 1 must be an object."],
        [[{ domains: [] }], "Bundle 1 must have a string title."],
        [[{ title: "Bad" }], "Bundle 1 must have a domains array containing only strings."],
        [[{ title: "Bad", domains: [1] }], "Bundle 1 must have a domains array containing only strings."],
        [[{ title: "Bad", domains: [], color: "chartreuse" }], "Bundle 1 has an unsupported color."],
    ])("rejects malformed JSON structures: %s", (value, message) => {
        expect(() => coerceGroupsFromJson(value)).toThrow(message);
    });
});

describe("settings backup validation", () => {
    it("accepts known settings with valid types and retains unknown settings", () => {
        const settings = { ...structuredClone(DEFAULTS), futureSetting: { retained: true } };
        expect(validateImportedSettings(settings, DEFAULTS.autoGroupPrefix)).toEqual(settings);
    });

    it("allows known settings to be omitted so imports retain their stored values", () => {
        expect(validateImportedSettings({
            autoGroupPrefix: DEFAULTS.autoGroupPrefix,
            futureSetting: true,
        }, DEFAULTS.autoGroupPrefix)).toEqual({
            autoGroupPrefix: DEFAULTS.autoGroupPrefix,
            futureSetting: true,
        });
    });

    it("rejects exact domain rules shared by multiple bundles after canonicalization", () => {
        const settings = {
            ...structuredClone(DEFAULTS),
            customDomainGroups: [
                { title: "First", domains: ["example.com"] },
                { title: "Second", domains: [" EXAMPLE.COM "] },
            ],
        };

        expect(() => validateImportedSettings(settings, DEFAULTS.autoGroupPrefix))
            .toThrow("contains a domain rule used by more than one bundle");
    });

    it("canonicalizes imported hostname arrays before they are stored", () => {
        const settings = {
            autoGroupPrefix: DEFAULTS.autoGroupPrefix,
            commonMultipartSuffixes: [" CO.UK ", "co.uk", "com.au\nORG.UK", "  "],
            excludedFromRootCollapse: [" WWW.Example.COM "],
            ignoredHostnames: ["Docs.Example.com", " docs.example.com "],
        };

        expect(validateImportedSettings(settings, DEFAULTS.autoGroupPrefix)).toEqual({
            autoGroupPrefix: DEFAULTS.autoGroupPrefix,
            commonMultipartSuffixes: ["co.uk", "com.au", "org.uk"],
            excludedFromRootCollapse: ["www.example.com"],
            ignoredHostnames: ["docs.example.com"],
        });
        expect(settings.commonMultipartSuffixes).toEqual([" CO.UK ", "co.uk", "com.au\nORG.UK", "  "]);
    });

    it.each([
        ["autoGroupPrefix", "other", "required SumTabs managed-group prefix"],
        ["minTabsToGroup", "2", "must be a whole number"],
        ["collapseOtherGroupsOnNavEvents", 1, "must be true or false"],
        ["keepManagedGroupsAtFront", null, "must be true or false"],
        ["ungroupSingletonManagedGroups", "false", "must be true or false"],
        ["ignoreInitialTabUrlForGrouping", 0, "must be true or false"],
        ["ignoreInitialTabUrlForEnforcement", undefined, "must be true or false"],
        ["commonMultipartSuffixes", "co.uk", "must be an array of hostnames"],
        ["excludedFromRootCollapse", [1], "must be an array of hostnames"],
        ["ignoredHostnames", ["https://example.com"], "contains an invalid hostname"],
        ["customDomainGroups", "not-an-array", "top-level JSON value must be an array"],
        ["customDomainGroups", [{ title: "Invalid", domains: [1] }], "domains array containing only strings"],
    ])("rejects malformed %s without normalizing it into storage", (key, value, message) => {
        const settings = { ...structuredClone(DEFAULTS), [key]: value };
        expect(() => validateImportedSettings(settings, DEFAULTS.autoGroupPrefix)).toThrow(message);
    });
});
