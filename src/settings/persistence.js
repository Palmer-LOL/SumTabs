import { DEFAULTS } from "../core/defaults.js";
import { arrayToLines } from "./validation.js";

const IGNORED_HOSTNAMES_STORAGE_LOCK = "sumtabs:ignored-hostnames-storage";

export function createSettingsPersistence({
    chromeApi,
    navigatorRef,
    windowRef,
    elements,
    editor,
    setStatus,
}) {
    let savedSnapshot = "";
    let loading = true;
    let savingIgnoredHostnamesValue = null;
    let ignoredHostnamesBaseline = "";
    let ignoredHostnamesConflict = null;

    function storedIgnoredHostnamesText(settings) {
        return arrayToLines(settings.ignoredHostnames ?? DEFAULTS.ignoredHostnames);
    }

    function updateIgnoredHostnamesSnapshot(value) {
        if (!savedSnapshot) return;
        const snapshot = JSON.parse(savedSnapshot);
        snapshot.ignoredHostnames = value;
        savedSnapshot = JSON.stringify(snapshot);
    }

    function clearIgnoredHostnamesConflict() {
        ignoredHostnamesConflict = null;
        elements.ignoredHostnamesConflict.hidden = true;
    }

    function acceptIgnoredHostnamesBaseline(value, { updateEditor = false } = {}) {
        ignoredHostnamesBaseline = value;
        updateIgnoredHostnamesSnapshot(value);
        if (updateEditor) elements.ignoredHostnames.value = value;
        clearIgnoredHostnamesConflict();
    }

    function showIgnoredHostnamesConflict(storedValue) {
        ignoredHostnamesConflict = { storedValue };
        elements.ignoredHostnamesConflict.hidden = false;
        updateSaveState({
            message: "Resolve the ignored-hostname conflict before saving.",
            state: "error",
        });
    }

    function handleExternalIgnoredHostnames(value) {
        const incomingValue = arrayToLines(value ?? DEFAULTS.ignoredHostnames);
        const localValue = elements.ignoredHostnames.value;

        if (localValue === ignoredHostnamesBaseline) {
            acceptIgnoredHostnamesBaseline(incomingValue, { updateEditor: true });
        } else if (incomingValue === localValue) {
            acceptIgnoredHostnamesBaseline(incomingValue);
        } else if (incomingValue !== ignoredHostnamesBaseline) {
            showIgnoredHostnamesConflict(incomingValue);
            return;
        } else {
            // The stored value returned to the baseline, so any conflict raised
            // for an intermediate external value is no longer relevant.
            clearIgnoredHostnamesConflict();
        }
        updateSaveState();
    }

    function hasUiChanges() {
        return editor.captureUiSnapshot() !== savedSnapshot;
    }

    function hasUnsavedChanges() {
        return hasUiChanges() || editor.hasJsonDraft();
    }

    function updateSaveState(customMessage = null) {
        if (loading) return;

        const errors = editor.validateSettings();
        const dirty = hasUiChanges();
        const saveBlocked = errors.length > 0 || editor.hasJsonDraft() || !!ignoredHostnamesConflict;
        elements.save.disabled = !dirty || saveBlocked;

        if (customMessage) {
            setStatus(customMessage.message, customMessage.state);
        } else if (errors.length) {
            setStatus(`${errors.length} ${errors.length === 1 ? "issue needs" : "issues need"} attention before saving.`, "error");
        } else if (editor.hasJsonDraft()) {
            setStatus("Raw JSON has unapplied changes.", "warning");
        } else if (ignoredHostnamesConflict) {
            setStatus("Resolve the ignored-hostname conflict before saving.", "error");
        } else if (dirty) {
            setStatus("Unsaved changes.", "warning");
        } else {
            setStatus("No unsaved changes.", "neutral");
        }
    }

    async function load() {
        loading = true;
        let stored;
        try {
            stored = await chromeApi.storage.sync.get(DEFAULTS);
        } catch (error) {
            loading = false;
            throw error;
        }
        editor.populateForm(stored);
        savedSnapshot = editor.captureUiSnapshot();
        ignoredHostnamesBaseline = storedIgnoredHostnamesText(stored);
        clearIgnoredHostnamesConflict();
        loading = false;
        updateSaveState();
    }

    async function save() {
        const editorValues = editor.getPersistenceValues();
        const errors = editor.validateSettings();
        if (errors.length || editor.hasJsonDraft() || ignoredHostnamesConflict) {
            updateSaveState();
            return;
        }

        const localIgnoredHostnames = arrayToLines(editorValues.ignoredHostnames);
        elements.save.disabled = true;
        setStatus("Saving…", "neutral");

        try {
            const savedSettings = await navigatorRef.locks.request(IGNORED_HOSTNAMES_STORAGE_LOCK, async () => {
                // Keep the conflict check and write in one critical section shared
                // with the popup so its quick action cannot land between them.
                const latest = await chromeApi.storage.sync.get(DEFAULTS);
                const latestIgnoredHostnames = storedIgnoredHostnamesText(latest);
                if (latestIgnoredHostnames !== ignoredHostnamesBaseline) {
                    if (elements.ignoredHostnames.value === ignoredHostnamesBaseline) {
                        acceptIgnoredHostnamesBaseline(latestIgnoredHostnames, { updateEditor: true });
                    } else if (latestIgnoredHostnames === localIgnoredHostnames) {
                        acceptIgnoredHostnamesBaseline(latestIgnoredHostnames);
                    } else {
                        showIgnoredHostnamesConflict(latestIgnoredHostnames);
                        return null;
                    }
                }

                const baseline = JSON.parse(savedSnapshot);
                const current = JSON.parse(editor.captureUiSnapshot());
                const payload = {};
                const copyIfChanged = (uiKey, ...storageKeys) => {
                    if (JSON.stringify(current[uiKey]) === JSON.stringify(baseline[uiKey])) return;
                    for (const storageKey of storageKeys) payload[storageKey] = editorValues[storageKey];
                };
                copyIfChanged("minTabsToGroup", "minTabsToGroup");
                copyIfChanged("collapseOtherGroupsOnNavEvents", "collapseOtherGroupsOnNavEvents");
                copyIfChanged("keepManagedGroupsAtFront", "keepManagedGroupsAtFront");
                copyIfChanged("ungroupSingletonManagedGroups", "ungroupSingletonManagedGroups");
                // Always align both legacy keys with the combined control. Older
                // synced versions read these independently, and may have left them
                // divergent even when this page's combined value is unchanged.
                payload.ignoreInitialTabUrlForGrouping = editorValues.ignoreInitialTabUrlForGrouping;
                payload.ignoreInitialTabUrlForEnforcement = editorValues.ignoreInitialTabUrlForEnforcement;
                copyIfChanged("commonMultipartSuffixes", "commonMultipartSuffixes");
                copyIfChanged("excludedFromRootCollapse", "excludedFromRootCollapse");
                copyIfChanged("ignoredHostnames", "ignoredHostnames");
                copyIfChanged("customDomainGroups", "customDomainGroups");

                savingIgnoredHostnamesValue = Object.hasOwn(payload, "ignoredHostnames")
                    ? arrayToLines(payload.ignoredHostnames)
                    : null;
                await chromeApi.storage.sync.set(payload);
                return { ...latest, ...payload };
            });
            if (!savedSettings) return;
            editor.populateForm(savedSettings);
            savedSnapshot = editor.captureUiSnapshot();
            ignoredHostnamesBaseline = storedIgnoredHostnamesText(savedSettings);
            clearIgnoredHostnamesConflict();
            updateSaveState({ message: "Changes saved.", state: "valid" });
        } catch (error) {
            console.error("Failed to save SumTabs settings", error);
            updateSaveState({ message: "Could not save changes. Try again.", state: "error" });
        } finally {
            savingIgnoredHostnamesValue = null;
        }
    }

    async function discardChanges() {
        const stored = await chromeApi.storage.sync.get(DEFAULTS);
        editor.populateForm(stored);
        savedSnapshot = editor.captureUiSnapshot();
        ignoredHostnamesBaseline = storedIgnoredHostnamesText(stored);
        clearIgnoredHostnamesConflict();
        updateSaveState({ message: "Unsaved changes discarded.", state: "neutral" });
    }

    function loadDefaults() {
        const confirmed = windowRef.confirm(
            "Load the default settings into this page?\n\nNothing will be changed until you select Save changes."
        );
        if (!confirmed) return;

        if (ignoredHostnamesConflict) {
            acceptIgnoredHostnamesBaseline(ignoredHostnamesConflict.storedValue);
        } else {
            clearIgnoredHostnamesConflict();
        }
        editor.loadDefaultsIntoEditor();
        updateSaveState({ message: "Defaults loaded. Save changes to apply them.", state: "warning" });
    }

    function handleStorageChange(changes, areaName) {
        if (areaName !== "sync" || !changes.ignoredHostnames || loading) return;
        const incomingValue = arrayToLines(changes.ignoredHostnames.newValue ?? DEFAULTS.ignoredHostnames);
        if (savingIgnoredHostnamesValue !== null && incomingValue === savingIgnoredHostnamesValue) return;
        handleExternalIgnoredHostnames(changes.ignoredHostnames.newValue);
    }

    function useStoredIgnoredHostnames() {
        if (!ignoredHostnamesConflict) return;
        acceptIgnoredHostnamesBaseline(ignoredHostnamesConflict.storedValue, { updateEditor: true });
        updateSaveState();
    }

    function keepDraftIgnoredHostnames() {
        if (!ignoredHostnamesConflict) return;
        acceptIgnoredHostnamesBaseline(ignoredHostnamesConflict.storedValue);
        updateSaveState();
    }

    return {
        load,
        save,
        discardChanges,
        loadDefaults,
        updateSaveState,
        handleStorageChange,
        hasUnsavedChanges,
        useStoredIgnoredHostnames,
        keepDraftIgnoredHostnames,
    };
}
