import { DEFAULTS } from "../core/defaults.js";
import { validateImportedSettings } from "./validation.js";

const IGNORED_HOSTNAMES_STORAGE_LOCK = "sumtabs:ignored-hostnames-storage";
const SETTINGS_BACKUP_FORMAT = "sumtabs-settings";
const SETTINGS_BACKUP_VERSION = 1;

export async function exportSettings({ chromeApi, documentRef, report }) {
    const stored = await chromeApi.storage.sync.get(null);
    const backup = {
        format: SETTINGS_BACKUP_FORMAT,
        version: SETTINGS_BACKUP_VERSION,
        settings: { ...structuredClone(DEFAULTS), ...stored },
    };
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = `sumtabs-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    report("Settings exported.", "valid");
}

export async function importSettingsFile({
    file,
    chromeApi,
    navigatorRef,
    windowRef,
    reload,
    report,
}) {
    let backup;
    try {
        backup = JSON.parse(await file.text());
    } catch {
        throw new Error("The selected file is not valid JSON.");
    }

    if (backup?.format !== SETTINGS_BACKUP_FORMAT
        || backup?.version !== SETTINGS_BACKUP_VERSION
        || !backup.settings
        || typeof backup.settings !== "object"
        || Array.isArray(backup.settings)) {
        throw new Error("The selected file is not a supported SumTabs settings backup.");
    }
    const importedSettings = validateImportedSettings(backup.settings, DEFAULTS.autoGroupPrefix);
    if (!windowRef.confirm(
        "Import these settings now?\n\nMatching synchronized settings will be overwritten. Settings not included in the backup will be retained."
    )) return;

    await navigatorRef.locks.request(IGNORED_HOSTNAMES_STORAGE_LOCK, () => (
        chromeApi.storage.sync.set(importedSettings)
    ));
    await reload();
    report("Settings imported.", "valid");
}
