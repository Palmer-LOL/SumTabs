import { createSettingsEditor } from "./editor.js";
import { createSettingsPersistence } from "./persistence.js";
import { exportSettings, importSettingsFile } from "./transfer.js";

const $ = (id) => document.getElementById(id);
const elements = {
    status: $("status"),
    save: $("save"),
    discard: $("discard"),
    reset: $("reset"),
    exportSettings: $("exportSettings"),
    importSettings: $("importSettings"),
    importSettingsFile: $("importSettingsFile"),
    ignoredHostnames: $("ignoredHostnames"),
    ignoredHostnamesConflict: $("ignoredHostnamesConflict"),
    useStoredIgnoredHostnames: $("useStoredIgnoredHostnames"),
    keepDraftIgnoredHostnames: $("keepDraftIgnoredHostnames"),
};

function setStatus(message, state = "neutral") {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
}

const editor = createSettingsEditor({ documentRef: document });
const persistence = createSettingsPersistence({
    chromeApi: chrome,
    navigatorRef: navigator,
    windowRef: window,
    elements,
    editor,
    setStatus,
});

chrome.storage.onChanged.addListener(persistence.handleStorageChange);

editor.bindEditorEvents({ updateSaveState: persistence.updateSaveState });

elements.save.addEventListener("click", () => {
    persistence.save().catch((error) => {
        console.error("Failed to save SumTabs settings", error);
        persistence.updateSaveState({ message: "Could not save changes. Try again.", state: "error" });
    });
});
elements.discard.addEventListener("click", () => {
    persistence.discardChanges().catch((error) => {
        console.error("Failed to discard SumTabs settings changes", error);
        persistence.updateSaveState({ message: "Could not reload saved settings. Try again.", state: "error" });
    });
});
elements.reset.addEventListener("click", persistence.loadDefaults);
elements.exportSettings.addEventListener("click", () => {
    exportSettings({
        chromeApi: chrome,
        documentRef: document,
        report: (message, state) => persistence.updateSaveState({ message, state }),
    }).catch((error) => {
        console.error("Failed to export SumTabs settings", error);
        persistence.updateSaveState({ message: "Could not export settings. Try again.", state: "error" });
    });
});
elements.importSettings.addEventListener("click", () => elements.importSettingsFile.click());
elements.importSettingsFile.addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    importSettingsFile({
        file,
        chromeApi: chrome,
        navigatorRef: navigator,
        windowRef: window,
        reload: persistence.load,
        report: (message, state) => persistence.updateSaveState({ message, state }),
    }).catch((error) => {
        console.error("Failed to import SumTabs settings", error);
        persistence.updateSaveState({ message: error.message || "Could not import settings.", state: "error" });
    });
});
elements.useStoredIgnoredHostnames.addEventListener("click", persistence.useStoredIgnoredHostnames);
elements.keepDraftIgnoredHostnames.addEventListener("click", persistence.keepDraftIgnoredHostnames);

window.addEventListener("beforeunload", (event) => {
    if (!persistence.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
});

persistence.load().catch((error) => {
    console.error("Failed to load SumTabs settings", error);
    setStatus("Could not load settings. Reload this page to try again.", "error");
});
