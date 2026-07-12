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
} from "../../settings-validation.js";

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
    it("coerces a valid array of bundle objects and ignores unknown properties", () => {
        expect(coerceGroupsFromJson([{ title: "AI", domains: ["chatgpt.com"], color: "Purple", extra: true }])).toEqual([
            { title: "AI", domainsText: "chatgpt.com", color: "purple" },
        ]);
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
