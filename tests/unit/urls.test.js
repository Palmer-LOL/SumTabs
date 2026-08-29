import { describe, expect, it } from "vitest";
import { isWebUrl, safeParseUrl } from "../../src/core/urls.js";

describe("safeParseUrl", () => {
  it("returns URL instances for valid HTTP and HTTPS inputs", () => {
    expect(safeParseUrl("http://example.test/path")?.href)
      .toBe("http://example.test/path");
    expect(safeParseUrl("https://example.test/")?.protocol).toBe("https:");
  });

  it("returns null for malformed or empty input", () => {
    expect(safeParseUrl("not a URL")).toBeNull();
    expect(safeParseUrl("")).toBeNull();
    expect(safeParseUrl(undefined)).toBeNull();
  });
});

describe("isWebUrl", () => {
  it.each(["http://example.test", "https://example.test"])(
    "accepts the supported web URL %s",
    (value) => expect(isWebUrl(safeParseUrl(value))).toBe(true),
  );

  it.each([
    "chrome://extensions",
    "edge://extensions",
    "file:///tmp/example",
    "about:blank",
    "chrome-extension://abcdefghijklmnop/page.html",
    "data:text/plain,hello",
    "ftp://example.test/file",
  ])("rejects the unsupported URL %s", (value) => {
    expect(isWebUrl(safeParseUrl(value))).toBe(false);
  });

  it("rejects null", () => expect(isWebUrl(null)).toBe(false));
});
