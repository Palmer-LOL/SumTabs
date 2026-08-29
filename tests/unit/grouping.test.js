import { describe, expect, it } from "vitest";
import {
    buildCustomBundleMaps,
    getCustomDomainBundleEntryConflicts,
    getCustomDomainBundleEntryOwners,
    getDomainWideSeparationRule,
    getRootDomain,
    matchesParsedUrlAgainstRule,
    parseCustomDomainGroups,
    parseCustomDomainRule,
    resolveGroupingForHostname,
} from "../../grouping.js";

const prefix = "∑ ";
const multipart = ["co.uk", "com.au"];

function grouping(input) {
    return resolveGroupingForHostname({
        commonMultipartSuffixes: multipart,
        excludedFromRootCollapse: [],
        managedPrefix: prefix,
        ...input,
    });
}

describe("root-domain grouping helpers", () => {
    it.each([
        ["docs.google.com", "google.com", null],
        ["mail.google.com", "google.com", null],
        ["google.com", "google.com", null],
        ["WWW.Example.COM", "example.com", null],
        ["192.168.0.1", "192.168.0.1", null],
        ["shop.example.co.uk", "example.co.uk", "co.uk"],
        ["", undefined, undefined],
        [null, undefined, undefined],
    ])("resolves %s to the implementation's root-domain contract", (hostname, rootDomain, matchedSuffix) => {
        const result = getRootDomain(hostname, multipart);
        if (!hostname) {
            expect(result).toBe("");
            return;
        }
        expect(result).toMatchObject({ hostname: String(hostname).trim().toLowerCase(), rootDomain, matchedSuffix });
    });

    it("preserves the current IPv6-like hostname behavior as a non-special dotted fallback", () => {
        expect(getRootDomain("[2001:db8::1]", multipart)).toMatchObject({
            hostname: "[2001:db8::1]",
            rootDomain: "[2001:db8::1]",
            matchedSuffix: null,
        });
    });

    it("returns a domain-wide separation rule for multipart suffixes and ordinary roots", () => {
        expect(getDomainWideSeparationRule("shop.example.co.uk", multipart)).toMatchObject({
            token: "co.uk",
            affectsHostname: true,
        });
        expect(getDomainWideSeparationRule("docs.google.com", multipart)).toMatchObject({
            token: "google.com",
            affectsHostname: false,
        });
        expect(getDomainWideSeparationRule("192.168.0.1", multipart)).toBeNull();
    });
});

describe("custom domain rule parsing and path matching", () => {
    it.each([
        ["chatgpt.com", { hostname: "chatgpt.com", pathPrefix: null, matchMode: "host_only", valid: true }],
        [" ChatGPT.com/Codex/* ", { hostname: "chatgpt.com", pathPrefix: "/codex", matchMode: "host_path_prefix", valid: true }],
        ["chatgpt.com//codex///agents/", { hostname: "chatgpt.com", pathPrefix: "/codex/agents", valid: true }],
        ["", { valid: false, error: "Domain entry is empty." }],
        ["https://example.com", { valid: false, error: "Protocols are not allowed." }],
    ])("canonicalizes %s", (raw, expected) => {
        expect(parseCustomDomainRule(raw)).toMatchObject(expected);
    });

    it.each([
        ["/codex", true],
        ["/codex/agents", true],
        ["/Codex/Agents?x=1#frag", true],
        ["/codexx", false],
        ["/other", false],
    ])("matches /codex path-boundary rules against %s as documented", (path, expected) => {
        const rule = parseCustomDomainRule("chatgpt.com/codex/*");
        expect(matchesParsedUrlAgainstRule(new URL(`https://chatgpt.com${path}`), rule)).toBe(expected);
    });

    it("does not let query strings or fragments alter path-prefix grouping", () => {
        const rule = parseCustomDomainRule("chatgpt.com/codex");
        expect(matchesParsedUrlAgainstRule(new URL("https://chatgpt.com/codex?not=/codexx#frag"), rule)).toBe(true);
        expect(matchesParsedUrlAgainstRule(new URL("https://chatgpt.com/other?path=/codex"), rule)).toBe(false);
    });
});

describe("custom bundle maps, ownership, and conflicts", () => {
    const bundles = [
        { title: "AI", domains: ["chatgpt.com", "claude.ai", "chatgpt.com/codex", "ChatGPT.com/codex/*"] },
        { title: "News", domains: ["nytimes.com", "theatlantic.com"] },
        { title: "Duplicate", domains: ["claude.ai"] },
        { title: "Ignored", domains: ["", "https://bad.example"] },
        { title: "", domains: ["empty-title.example"] },
        { title: "Malformed" },
    ];

    it("parses only titled bundles with domain arrays and keeps invalid rule objects for deterministic filtering", () => {
        const parsed = parseCustomDomainGroups(bundles);
        expect(parsed.map((group) => group.title)).toEqual(["AI", "News", "Duplicate", "Ignored"]);
        expect(parsed[3].parsedRules.map((rule) => rule.valid)).toEqual([false, false]);
    });

    it("builds deterministic exact and root maps from valid bundle rules", () => {
        const maps = buildCustomBundleMaps(bundles);
        expect([...maps.exactHostnameToBundleRules.keys()]).toEqual(["chatgpt.com", "claude.ai", "nytimes.com", "theatlantic.com"]);
        expect(maps.exactHostnameToBundleRules.get("chatgpt.com").map((entry) => entry.title)).toEqual(["AI", "AI", "AI"]);
    });

    it.each([
        ["missing.example", []],
        ["claude.ai", ["AI", "Duplicate"]],
        ["chatgpt.com/codex", ["AI", "AI"]],
    ])("returns stable owners for %s", (entry, titles) => {
        expect(getCustomDomainBundleEntryOwners(bundles, entry).map((owner) => owner.title)).toEqual(titles);
    });

    it("reports duplicate identical and canonically equivalent bundle rules without merging host-only and path-scoped distinctions", () => {
        const conflicts = getCustomDomainBundleEntryConflicts(bundles);
        expect(conflicts).toEqual([
            expect.objectContaining({ entry: "claude.ai", owners: expect.arrayContaining([expect.objectContaining({ groupIndex: 0 }), expect.objectContaining({ groupIndex: 2 })]) }),
            expect.objectContaining({ entry: "chatgpt.com/codex", owners: expect.arrayContaining([expect.objectContaining({ domainIndex: 2 }), expect.objectContaining({ domainIndex: 3 })]) }),
        ]);
    });
});

describe("ignored-hostname grouping precedence", () => {
    const bundleMaps = buildCustomBundleMaps([
        { title: "Host bundle", domains: ["docs.example.com"] },
        { title: "Path bundle", domains: ["docs.example.com/research"] },
    ]);

    it.each(["docs.example.com", "Docs.Example.COM"])("ignores an exact, case-normalized match for %s", (hostname) => {
        expect(grouping({ hostname, ignoredHostnames: ["DOCS.EXAMPLE.COM"] })).toBeNull();
    });

    it("does not inherit ignores between parent domains and subdomains", () => {
        expect(grouping({ hostname: "example.com", ignoredHostnames: ["docs.example.com"] })).not.toBeNull();
        expect(grouping({ hostname: "child.docs.example.com", ignoredHostnames: ["docs.example.com"] })).not.toBeNull();
        expect(grouping({ hostname: "docs.example.com", ignoredHostnames: ["example.com"] })).not.toBeNull();
    });

    it("takes precedence over default grouping, bundles, path bundles, and both separation rule types", () => {
        const common = {
            hostname: "docs.example.com",
            ignoredHostnames: new Set(["docs.example.com"]),
            excludedFromRootCollapse: ["docs.example.com"],
            commonMultipartSuffixes: ["example.com"],
            customBundleMaps: bundleMaps,
        };
        expect(grouping(common)).toBeNull();
        expect(grouping({ ...common, url: "https://docs.example.com/research/paper" })).toBeNull();
    });
});

describe("grouping resolution precedence", () => {
    it("accepts http and https URLs and ignores path/query/fragment for default hostname grouping", () => {
        expect(grouping({ url: "http://docs.google.com/a?x=1#frag", hostname: "docs.google.com" })).toMatchObject({
            identity: "∑ google.com",
            reason: "default-root-domain-grouping",
        });
        expect(grouping({ url: "https://mail.google.com/other", hostname: "mail.google.com" })).toMatchObject({
            identity: "∑ google.com",
            reason: "default-root-domain-grouping",
        });
    });

    it("does not perform protocol eligibility checks inside resolveGroupingForHostname; callers must filter URLs", () => {
        expect(grouping({ url: "chrome://settings", hostname: "settings" })).toMatchObject({
            identity: "∑ settings",
            reason: "default-root-domain-grouping",
        });
    });

    it("uses exact-host separation before the default root-domain fallback but not for sibling hosts", () => {
        expect(grouping({ hostname: "Docs.Google.com", excludedFromRootCollapse: ["docs.google.com"] })).toMatchObject({
            groupKey: "docs.google.com",
            reason: "exact-host-separation",
        });
        expect(grouping({ hostname: "mail.google.com", excludedFromRootCollapse: ["docs.google.com"] })).toMatchObject({
            groupKey: "google.com",
            reason: "default-root-domain-grouping",
        });
    });

    it("uses multipart suffix rules before ordinary default grouping", () => {
        expect(grouping({ hostname: "shop.example.co.uk" })).toMatchObject({
            groupKey: "example.co.uk",
            matchedSuffix: "co.uk",
            reason: "multipart-suffix-separation",
        });
        expect(grouping({ hostname: "badco.uk.example" })).toMatchObject({
            groupKey: "uk.example",
            matchedSuffix: null,
            reason: "default-root-domain-grouping",
        });
    });

    it("groups unrelated hosts into a custom bundle and returns bundle title identity", () => {
        const maps = buildCustomBundleMaps([{ title: "Research", domains: ["arxiv.org", "example.com"] }]);
        expect(grouping({ hostname: "arxiv.org", customBundleMaps: maps })).toMatchObject({ identity: "∑ Research", displayGroupingLabel: "Research" });
        expect(grouping({ hostname: "example.com", customBundleMaps: maps })).toMatchObject({ identity: "∑ Research" });
    });

    it("gives exact path-scoped bundle rules precedence over same-host host-only rules and longest path wins", () => {
        const maps = buildCustomBundleMaps([
            { title: "Host", domains: ["chatgpt.com"] },
            { title: "Codex", domains: ["chatgpt.com/codex"] },
            { title: "Agents", domains: ["chatgpt.com/codex/agents"] },
        ]);
        expect(grouping({ url: "https://chatgpt.com/codex", hostname: "chatgpt.com", customBundleMaps: maps })).toMatchObject({ identity: "∑ Codex" });
        expect(grouping({ url: "https://chatgpt.com/codex/agents/new", hostname: "chatgpt.com", customBundleMaps: maps })).toMatchObject({ identity: "∑ Agents" });
        expect(grouping({ url: "https://chatgpt.com/other", hostname: "chatgpt.com", customBundleMaps: maps })).toMatchObject({ identity: "∑ Host" });
    });

    it("gives exact-host bundle rules precedence over inherited root-domain bundle rules and exact-host separation", () => {
        const maps = buildCustomBundleMaps([
            { title: "Root", domains: ["example.com"] },
            { title: "Docs", domains: ["docs.example.com"] },
        ]);
        expect(grouping({ hostname: "docs.example.com", excludedFromRootCollapse: ["docs.example.com"], customBundleMaps: maps })).toMatchObject({
            identity: "∑ Docs",
            reason: "custom-bundle-grouping",
        });
        expect(grouping({ hostname: "mail.example.com", customBundleMaps: maps })).toMatchObject({ identity: "∑ Root" });
    });

    it("falls back to ordinary grouping when no bundle rule matches", () => {
        const maps = buildCustomBundleMaps([{ title: "AI", domains: ["chatgpt.com/codex"] }]);
        expect(grouping({ url: "https://chatgpt.com/other", hostname: "chatgpt.com", customBundleMaps: maps })).toMatchObject({
            identity: "∑ chatgpt.com",
            reason: "default-root-domain-grouping",
        });
    });
});
