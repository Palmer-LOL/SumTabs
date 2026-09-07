import { describe, expect, it } from "vitest";
import {
    buildBundleRuleEntry,
    getBundleRuleOptions,
    previewBundleRule,
} from "../../src/core/bundle-rule-options.js";

describe("bundle rule options", () => {
    it("rejects unavailable, malformed, and non-web URLs", () => {
        for (const url of [undefined, "not a URL", "chrome://settings", "file:///tmp/a"]) {
            expect(getBundleRuleOptions({ url, commonMultipartSuffixes: [] })).toEqual({
                supported: false,
                hostname: "",
                rootDomain: "",
                hostOptions: [],
                pathOptions: [],
            });
        }
    });

    it("offers the exact hostname and calculated inherited root scope without duplicates", () => {
        expect(getBundleRuleOptions({
            url: "https://Docs.Team.Example.CO.UK:8443/projects",
            commonMultipartSuffixes: ["co.uk"],
        })).toMatchObject({
            supported: true,
            hostname: "docs.team.example.co.uk",
            rootDomain: "example.co.uk",
            hostOptions: [
                { value: "docs.team.example.co.uk", label: "docs.team.example.co.uk" },
                { value: "example.co.uk", label: "example.co.uk and its subdomains" },
            ],
        });

        expect(getBundleRuleOptions({
            url: "https://example.com/",
            commonMultipartSuffixes: [],
        }).hostOptions).toEqual([{ value: "example.com", label: "example.com and its subdomains" }]);
    });

    it("offers all paths and each canonical whole-segment prefix, ignoring query and fragment", () => {
        expect(getBundleRuleOptions({
            url: "https://docs.example.com/projects/alpha/issues?sort=new#top",
            commonMultipartSuffixes: [],
        }).pathOptions).toEqual([
            { value: "", label: "All paths" },
            { value: "/projects", label: "/projects and descendants" },
            { value: "/projects/alpha", label: "/projects/alpha and descendants" },
            { value: "/projects/alpha/issues", label: "This path and descendants" },
        ]);
    });

    it("preserves encoded segments and deduplicates paths that canonicalize identically", () => {
        expect(getBundleRuleOptions({
            url: "https://example.com/A%20B//C%2Fd/",
            commonMultipartSuffixes: [],
        }).pathOptions).toEqual([
            { value: "", label: "All paths" },
            { value: "/a%20b", label: "/a%20b and descendants" },
            { value: "/a%20b/c%2fd", label: "This path and descendants" },
        ]);
    });
});

describe("bundle rule entry construction", () => {
    it.each([
        [{ hostname: " Docs.Example.COM ", pathPrefix: "" }, "docs.example.com"],
        [{ hostname: "Docs.Example.COM", pathPrefix: "/Projects/Alpha/" }, "docs.example.com/projects/alpha"],
        [{ hostname: "example.com", pathPrefix: "/A%20B/C%2Fd" }, "example.com/a%20b/c%2fd"],
    ])("builds a canonical entry from %o", (input, canonicalEntry) => {
        expect(buildBundleRuleEntry(input)).toEqual({ valid: true, canonicalEntry });
    });

    it.each([
        [{ hostname: "https://example.com", pathPrefix: "" }],
        [{ hostname: "example.com:8443", pathPrefix: "" }],
        [{ hostname: "example.com", pathPrefix: "projects" }],
        [{ hostname: "example.com", pathPrefix: "/projects?sort=new" }],
        [{ hostname: "example.com", pathPrefix: "/projects#top" }],
    ])("rejects an invalid composed scope %o", (input) => {
        expect(buildBundleRuleEntry(input)).toMatchObject({ valid: false, error: expect.any(String) });
    });
});

describe("bundle rule preview", () => {
    const settings = {
        autoGroupPrefix: "∑ ",
        commonMultipartSuffixes: [],
        excludedFromRootCollapse: [],
        ignoredHostnames: [],
        customDomainGroups: [
            { title: "Root", color: "blue", domains: ["example.com"] },
            { title: "Docs", color: "red", domains: ["docs.example.com/guides"] },
            { title: "Duplicate", domains: ["DOCS.EXAMPLE.COM/GUIDES/*"] },
        ],
    };

    it("reports every canonical owner and preserves owner order", () => {
        expect(previewBundleRule({
            url: "https://docs.example.com/guides/start",
            settings,
            bundleIndex: 0,
            entry: "docs.example.com/GUIDES/",
        }).ownership).toEqual([
            { groupIndex: 1, domainIndex: 0, title: "Docs", entry: "docs.example.com/guides" },
            { groupIndex: 2, domainIndex: 0, title: "Duplicate", entry: "docs.example.com/guides" },
        ]);
    });

    it("previews existing precedence and the winning bundle after a hypothetical path rule", () => {
        const preview = previewBundleRule({
            url: "https://docs.example.com/projects/alpha?x=1#top",
            settings,
            bundleIndex: 1,
            entry: "docs.example.com/projects",
        });
        expect(preview.beforeGrouping).toMatchObject({ matchedCustomBundleTitle: "Root" });
        expect(preview.afterGrouping).toMatchObject({ matchedCustomBundleTitle: "Docs" });
        expect(settings.customDomainGroups[1].domains).toEqual(["docs.example.com/guides"]);
    });

    it("allows a root rule to remain shadowed by an existing exact-host rule", () => {
        const preview = previewBundleRule({
            url: "https://docs.example.com/guides/start",
            settings,
            bundleIndex: 0,
            entry: "example.com/guides",
        });
        expect(preview.beforeGrouping).toMatchObject({ matchedCustomBundleTitle: "Docs" });
        expect(preview.afterGrouping).toMatchObject({ matchedCustomBundleTitle: "Docs" });
    });

    it("returns null groupings for unsupported URLs and tolerates non-array bundles", () => {
        expect(previewBundleRule({
            url: "chrome://settings",
            settings: { ...settings, customDomainGroups: null },
            bundleIndex: 0,
            entry: "example.com",
        })).toEqual({ ownership: [], beforeGrouping: null, afterGrouping: null });
    });
});
