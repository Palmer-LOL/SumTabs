import { describe, expect, it, vi } from "vitest";
import { createSettingsPersistence } from "../../src/settings/persistence.js";
import { DEFAULTS } from "../../src/core/defaults.js";

function createHarness(initialGroups) {
    let stored = { ...structuredClone(DEFAULTS), customDomainGroups: structuredClone(initialGroups), future: 1 };
    let ui = { minTabsToGroup: String(stored.minTabsToGroup), ignoredHostnames: "", customDomainGroups: structuredClone(initialGroups) };
    let jsonDraft = false;
    const elements = {
        save: { disabled: false }, ignoredHostnames: { value: "" },
        ignoredHostnamesConflict: { hidden: true }, bundleConflict: { hidden: true },
    };
    const editor = {
        populateForm: vi.fn((settings) => { ui = { minTabsToGroup: String(settings.minTabsToGroup), ignoredHostnames: (settings.ignoredHostnames ?? []).join("\n"), customDomainGroups: structuredClone(settings.customDomainGroups ?? []) }; elements.ignoredHostnames.value = ui.ignoredHostnames; jsonDraft = false; }),
        captureUiSnapshot: vi.fn(() => JSON.stringify(ui)),
        hasJsonDraft: vi.fn(() => jsonDraft),
        validateSettings: vi.fn(() => []),
        getPersistenceValues: vi.fn(() => ({ ...structuredClone(DEFAULTS), minTabsToGroup: Number(ui.minTabsToGroup), ignoredHostnames: elements.ignoredHostnames.value ? elements.ignoredHostnames.value.split("\n") : [], customDomainGroups: structuredClone(ui.customDomainGroups) })),
        setGroupsState: vi.fn((groups) => { ui.customDomainGroups = structuredClone(groups); }),
        replaceGroupsFromStorage: vi.fn((groups) => { ui.customDomainGroups = structuredClone(groups); jsonDraft = false; }),
        loadDefaultsIntoEditor: vi.fn(),
    };
    const chromeApi = { storage: { sync: { get: vi.fn(async () => structuredClone(stored)), set: vi.fn(async payload => { stored = { ...stored, ...structuredClone(payload) }; }) } } };
    const persistence = createSettingsPersistence({ chromeApi, navigatorRef: { locks: { request: vi.fn(async (_n, cb) => cb()) } }, windowRef: { confirm: vi.fn() }, elements, editor, setStatus: vi.fn() });
    return { persistence, chromeApi, editor, elements, getStored: () => stored, setStored: value => { stored = value; }, edit: patch => { ui = { ...ui, ...structuredClone(patch) }; }, setJsonDraft: value => { jsonDraft = value; } };
}

describe("settings bundle conflict coordination", () => {
    it("absorbs external bundles when the bundle editor is clean while preserving another draft", async () => {
        const a = [{ title: "A", domains: [] }];
        const b = [{ title: "A", domains: ["popup.example"], extra: true }];
        const h = createHarness(a);
        await h.persistence.load();
        h.edit({ minTabsToGroup: "3" });

        h.persistence.handleStorageChange({ customDomainGroups: { newValue: b } }, "sync");

        expect(h.editor.replaceGroupsFromStorage).toHaveBeenCalled();
        expect(JSON.parse(h.editor.captureUiSnapshot()).minTabsToGroup).toBe("3");
        expect(JSON.parse(h.editor.captureUiSnapshot()).customDomainGroups).toEqual(b);
        expect(h.elements.bundleConflict.hidden).toBe(true);
    });

    it("requires an explicit choice when structured bundles or raw JSON are dirty", async () => {
        const a = [{ title: "A", domains: [] }];
        const b = [{ title: "B", domains: [] }];
        const h = createHarness(a);
        await h.persistence.load();
        h.edit({ customDomainGroups: [{ title: "Draft", domains: [] }] });
        h.persistence.handleStorageChange({ customDomainGroups: { newValue: b } }, "sync");
        expect(h.elements.bundleConflict.hidden).toBe(false);
        expect(h.elements.save.disabled).toBe(true);

        h.persistence.keepDraftBundles();
        expect(h.elements.bundleConflict.hidden).toBe(true);
        expect(JSON.parse(h.editor.captureUiSnapshot()).customDomainGroups[0].title).toBe("Draft");

        const raw = createHarness(a);
        await raw.persistence.load();
        raw.setJsonDraft(true);
        raw.persistence.handleStorageChange({ customDomainGroups: { newValue: b } }, "sync");
        expect(raw.elements.bundleConflict.hidden).toBe(false);
        raw.persistence.useStoredBundles();
        expect(JSON.parse(raw.editor.captureUiSnapshot()).customDomainGroups).toEqual(b);
    });

    it("rechecks bundles under the writer lock so an unrelated save preserves an external edit", async () => {
        const a = [{ title: "A", domains: [] }];
        const b = [{ title: "A", domains: ["popup.example"], unknown: 9 }];
        const h = createHarness(a);
        await h.persistence.load();
        h.edit({ minTabsToGroup: "4" });
        h.setStored({ ...h.getStored(), customDomainGroups: b });

        await h.persistence.save();

        expect(h.getStored().minTabsToGroup).toBe(4);
        expect(h.getStored().customDomainGroups).toEqual(b);
        expect(h.chromeApi.storage.sync.set.mock.calls[0][0]).not.toHaveProperty("customDomainGroups");
    });
});
