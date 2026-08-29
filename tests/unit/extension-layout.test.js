import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));

// This repository-specific static resolver intentionally does not cover
// computed imports, computed chrome.runtime.getURL arguments, generated HTML,
// or manifest fields added in the future without a corresponding test update.

function resolveInsideRoot(baseDirectory, reference) {
  const resolved = path.resolve(baseDirectory, reference);
  const relative = path.relative(repoRoot, resolved);
  expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
  return resolved;
}

function expectFile(baseDirectory, reference) {
  const resolved = resolveInsideRoot(baseDirectory, reference);
  expect(existsSync(resolved), reference).toBe(true);
  expect(statSync(resolved).isFile(), reference).toBe(true);
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(target);
    return entry.isFile() && entry.name.endsWith(".css") ? [target] : [];
  });
}

function references(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1] || match[2]);
}

const expectedIcons = {
  "16": "assets/icons/16.png",
  "48": "assets/icons/48.png",
  "128": "assets/icons/128.png",
};

const requiredFiles = [
  "src/core/defaults.js",
  "src/core/grouping.js",
  "src/core/urls.js",
  "src/ui/base.css",
  "src/ui/theme.css",
  "src/ui/theme.js",
  "src/background/index.js",
  "src/background/settings-state.js",
  "src/background/chrome-groups.js",
  "src/background/tab-controller.js",
  "src/popup/popup.html",
  "src/popup/index.js",
  "src/popup/active-tab-status.js",
  "src/popup/quick-actions.js",
  "src/popup/window-actions.js",
  "src/popup/window-summary.js",
  "src/popup/popup.css",
  "src/popup/window-actions.css",
  "src/settings/settings.html",
  "src/settings/index.js",
  "src/settings/editor.js",
  "src/settings/persistence.js",
  "src/settings/transfer.js",
  "src/settings/validation.js",
  "assets/brand/SumTabs.svg",
  "assets/icons/16.png",
  "assets/icons/48.png",
  "assets/icons/128.png",
];

const obsoleteRootPaths = [
  "SumTabs.svg",
  "background.js",
  "defaults.js",
  "grouping.js",
  "popup.html",
  "popup.js",
  "popup-ui.js",
  "popup-ui.css",
  "settings.html",
  "settings.js",
  "settings-validation.js",
  "style.css",
  "theme.css",
  "theme.js",
  "window-actions.js",
  "window-actions.css",
  "window-summary.js",
  "icons",
];

describe("extension layout", () => {
  it("uses the approved manifest entry and icon paths", () => {
    expect(manifest.background).toEqual({
      service_worker: "src/background/index.js",
      type: "module",
    });
    expect(manifest.action.default_popup).toBe("src/popup/popup.html");
    expect(manifest.options_page).toBe("src/settings/settings.html");
    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action.default_icon).toEqual(expectedIcons);
  });

  it("resolves all manifest-selected files inside the extension root", () => {
    for (const reference of [
      manifest.background.service_worker,
      manifest.action.default_popup,
      manifest.options_page,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ]) {
      expectFile(repoRoot, reference);
    }
  });

  it("resolves local scripts and stylesheets from manifest-selected pages", () => {
    for (const pagePath of [
      manifest.action.default_popup,
      manifest.options_page,
    ]) {
      const pageFile = resolveInsideRoot(repoRoot, pagePath);
      const source = readFileSync(pageFile, "utf8");
      const pageReferences = references(
        source,
        /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi,
      );

      for (const reference of pageReferences) {
        expect(reference).not.toMatch(/^(?:[a-z]+:)?\/\//i);
        expectFile(path.dirname(pageFile), reference);
      }
    }
  });

  it("resolves static source imports and exports", () => {
    const pattern =
      /(?:import\s+(?:[^"'\\]*?\s+from\s+)?|export\s+[^"'\\]*?\s+from\s+)["']([^"']+)["']/g;

    for (const sourceFile of javascriptFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        expect(reference.startsWith("."), reference).toBe(true);
        expectFile(path.dirname(sourceFile), reference);
      }
    }
  });

  it("resolves literal runtime resources from the extension root", () => {
    const pattern = /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g;
    const found = [];

    for (const sourceFile of javascriptFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        found.push(reference);
        expectFile(repoRoot, reference);
      }
    }

    expect(found).toContain("src/popup/window-actions.css");
  });

  it("resolves local CSS imports and URLs", () => {
    const pattern =
      /@import\s+["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;

    for (const sourceFile of cssFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        if (
          reference.startsWith("data:") ||
          reference.startsWith("#") ||
          /^[a-z]+:/i.test(reference)
        ) continue;
        expectFile(path.dirname(sourceFile), reference);
      }
    }
  });

  it("contains every file required by the approved layout", () => {
    for (const reference of requiredFiles) expectFile(repoRoot, reference);
  });

  it("does not retain obsolete root runtime paths", () => {
    for (const reference of obsoleteRootPaths) {
      expect(existsSync(path.join(repoRoot, reference)), reference).toBe(false);
    }
  });
});
