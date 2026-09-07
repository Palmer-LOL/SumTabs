import { describe, expect, it, vi } from "vitest";
import { createSettingsEditor } from "../../src/settings/editor.js";
import { createSettingsPersistence } from "../../src/settings/persistence.js";
import { DEFAULTS } from "../../src/core/defaults.js";

class FakeElement {
    constructor() {
        this.value = "";
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.dataset = {};
        this.options = [];
        this.listeners = new Map();
    }
    set innerHTML(_value) { this.options = []; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    appendChild(child) { this.options.push(child); }
    setAttribute(name, value) { this[name] = value; }
    focus() {}
    select() {}
    dispatch(type) { this.listeners.get(type)?.({ target: this }); }
}

function createHarness() {
    const ids = [
        "addGroup", "applyCustomDomainGroupsJson", "bundleEditorInterface", "bundleEmptyState",
        "collapseOtherGroupsOnNavEvents", "commonMultipartSuffixes", "createFirstGroup",
        "customDomainGroupsJson", "customDomainGroupsJsonStatus", "customGroupSelect",
        "excludedFromRootCollapse", "groupColor", "groupDomains", "groupDomainsValidation",
        "groupTitle", "groupTitleValidation", "ignoreInitialTabUrl", "ignoredHostnames",
        "keepManagedGroupsAtFront", "minTabsToGroup", "minTabsToGroupValidation", "removeGroup",
        "resetCustomDomainGroupsJson", "undoDelete", "ungroupSingletonManagedGroups",
    ];
    const nodes = Object.fromEntries(ids.map(id => [id, new FakeElement()]));
    const documentRef = {
        getElementById: id => nodes[id],
        createElement: () => new FakeElement(),
    };
    const editor = createSettingsEditor({ documentRef });
    const elements = {
        save: new FakeElement(),
        ignoredHostnames: nodes.ignoredHostnames,
        ignoredHostnamesConflict: new FakeElement(),
        bundleConflict: new FakeElement(),
    };
    elements.ignoredHostnamesConflict.hidden = true;
    elements.bundleConflict.hidden = true;
    let stored = {
        ...structuredClone(DEFAULTS),
        customDomainGroups: [{ title: "A", domains: [], metadata: { revision: 1 } }],
    };
    const chromeApi = { storage: { sync: {
        get: vi.fn(async () => structuredClone(stored)),
        set: vi.fn(async payload => { stored = { ...stored, ...structuredClone(payload) }; }),
    } } };
    const persistence = createSettingsPersistence({
        chromeApi,
        navigatorRef: { locks: { request: vi.fn(async (_name, callback) => callback()) } },
        windowRef: { confirm: vi.fn() },
        elements,
        editor,
        setStatus: vi.fn(),
    });
    editor.bindEditorEvents({ updateSaveState: persistence.updateSaveState });
    return { nodes, elements, editor, persistence, getStored: () => stored };
}

describe("Settings metadata persistence", () => {
    it("tracks an applied metadata-only JSON edit, saves it, and conflicts with external bundles", async () => {
        const h = createHarness();
        await h.persistence.load();

        h.nodes.customDomainGroupsJson.value = JSON.stringify([
            { title: "A", domains: [], metadata: { revision: 2 } },
        ]);
        h.nodes.customDomainGroupsJson.dispatch("input");
        h.nodes.applyCustomDomainGroupsJson.dispatch("click");

        expect(h.persistence.hasUnsavedChanges()).toBe(true);
        expect(h.elements.save.disabled).toBe(false);
        await h.persistence.save();
        expect(h.getStored().customDomainGroups).toEqual([
            { title: "A", domains: [], metadata: { revision: 2 } },
        ]);

        h.nodes.customDomainGroupsJson.value = JSON.stringify([
            { title: "A", domains: [], metadata: { revision: 3 } },
        ]);
        h.nodes.customDomainGroupsJson.dispatch("input");
        h.nodes.applyCustomDomainGroupsJson.dispatch("click");
        h.persistence.handleStorageChange({
            customDomainGroups: { newValue: [{ title: "A", domains: ["popup.example"], metadata: { revision: 4 } }] },
        }, "sync");

        expect(h.elements.bundleConflict.hidden).toBe(false);
        expect(h.elements.save.disabled).toBe(true);
        expect(h.editor.getPersistenceValues().customDomainGroups[0].metadata).toEqual({ revision: 3 });
    });
});
