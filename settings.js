import { DEFAULTS } from "./defaults.js";
import { getCustomDomainBundleEntryConflicts } from "./grouping.js";
import {
    MIN_GROUPING_THRESHOLD,
    VALID_GROUP_COLORS,
    arrayToLines,
    coerceGroupsFromJson,
    domainsToLines,
    groupsForPersistence as buildGroupsForPersistence,
    groupsForRawJson as buildGroupsForRawJson,
    normalizeStoredGroups,
    parseDomainsTextarea,
    parseHostnameRulesTextarea,
} from "./settings-validation.js";

const $ = (id) => document.getElementById(id);

let customGroupsState = [];
let selectedGroupIndex = -1;
let savedSnapshot = "";
let jsonDraftDirty = false;
let pendingDeletion = null;
let loading = true;
function setValidationMessage(element, message = "", state = "") {
    if (!element) return;
    element.textContent = message;
    if (state) element.dataset.state = state;
    else delete element.dataset.state;
}

function setFieldValidity(field, valid) {
    if (!field) return;
    field.setAttribute("aria-invalid", String(!valid));
}

function formatInvalidEntryMessage(invalidEntries, noun = "rule") {
    const first = invalidEntries[0];
    const extraCount = invalidEntries.length - 1;
    const extraMessage = extraCount > 0 ? ` (+${extraCount} more)` : "";
    return `${noun === "rule" ? "Invalid rule" : "Invalid hostname"}: “${first.raw}” — ${first.error}${extraMessage}`;
}

function getDuplicateDomainMessage(groups) {
    const conflicts = getCustomDomainBundleEntryConflicts(groups);
    if (!conflicts.length) return "";

    const firstConflict = conflicts[0];
    const titles = firstConflict.owners
        .map((owner) => owner.title || `Untitled bundle ${owner.groupIndex + 1}`)
        .join(", ");
    const extraCount = conflicts.length - 1;
    const extraMessage = extraCount > 0 ? ` (+${extraCount} more)` : "";
    return `Duplicate bundle rule “${firstConflict.entry}” appears in: ${titles}${extraMessage}`;
}

function validateSettings() {
    const errors = [];

    const minTabsField = $("minTabsToGroup");
    const minTabsValue = Number(minTabsField.value);
    const minTabsValid = Number.isInteger(minTabsValue) && minTabsValue >= MIN_GROUPING_THRESHOLD;
    setFieldValidity(minTabsField, minTabsValid);
    setValidationMessage(
        $("minTabsToGroupValidation"),
        minTabsValid ? "" : `Enter a whole number of ${MIN_GROUPING_THRESHOLD} or greater.`,
        minTabsValid ? "" : "error",
    );
    if (!minTabsValid) errors.push("Grouping threshold is invalid.");

    for (const config of [
        { fieldId: "commonMultipartSuffixes", validationId: "commonMultipartSuffixesValidation" },
        { fieldId: "excludedFromRootCollapse", validationId: "excludedFromRootCollapseValidation" },
        { fieldId: "ignoredHostnames", validationId: "ignoredHostnamesValidation" },
    ]) {
        const field = $(config.fieldId);
        const parsed = parseHostnameRulesTextarea(field.value);
        const valid = parsed.invalidEntries.length === 0;
        setFieldValidity(field, valid);
        setValidationMessage(
            $(config.validationId),
            valid ? `${parsed.validHostnames.length} valid ${parsed.validHostnames.length === 1 ? "hostname" : "hostnames"}.` : formatInvalidEntryMessage(parsed.invalidEntries, "hostname"),
            valid ? "valid" : "error",
        );
        if (!valid) errors.push(`${config.fieldId} contains invalid entries.`);
    }

    const groupErrors = customGroupsState.map((group, index) => {
        const titleMissing = !String(group?.title ?? "").trim();
        const parsedDomains = parseDomainsTextarea(group?.domainsText ?? "");
        if (titleMissing) errors.push(`Bundle ${index + 1} needs a title.`);
        if (parsedDomains.invalidEntries.length) errors.push(`Bundle ${index + 1} contains invalid rules.`);
        return { titleMissing, parsedDomains };
    });

    const duplicateMessage = getDuplicateDomainMessage(buildGroupsForPersistence(customGroupsState));
    if (duplicateMessage) errors.push(duplicateMessage);

    const currentGroup = customGroupsState[selectedGroupIndex];
    const currentValidation = groupErrors[selectedGroupIndex];
    const titleField = $("groupTitle");
    const domainsField = $("groupDomains");

    if (currentGroup && currentValidation) {
        setFieldValidity(titleField, !currentValidation.titleMissing);
        setValidationMessage(
            $("groupTitleValidation"),
            currentValidation.titleMissing ? "Enter a title for this bundle." : "",
            currentValidation.titleMissing ? "error" : "",
        );

        const domainsValid = currentValidation.parsedDomains.invalidEntries.length === 0 && !duplicateMessage;
        setFieldValidity(domainsField, domainsValid);
        if (currentValidation.parsedDomains.invalidEntries.length) {
            setValidationMessage(
                $("groupDomainsValidation"),
                formatInvalidEntryMessage(currentValidation.parsedDomains.invalidEntries),
                "error",
            );
        } else if (duplicateMessage) {
            setValidationMessage($("groupDomainsValidation"), duplicateMessage, "error");
        } else {
            const count = currentValidation.parsedDomains.validDomains.length;
            setValidationMessage(
                $("groupDomainsValidation"),
                `${count} valid ${count === 1 ? "rule" : "rules"}.`,
                "valid",
            );
        }
    } else {
        setFieldValidity(titleField, true);
        setFieldValidity(domainsField, true);
        setValidationMessage($("groupTitleValidation"));
        setValidationMessage($("groupDomainsValidation"));
    }

    return errors;
}

function captureUiSnapshot() {
    return JSON.stringify({
        minTabsToGroup: $("minTabsToGroup").value,
        collapseOtherGroupsOnNavEvents: $("collapseOtherGroupsOnNavEvents").checked,
        keepManagedGroupsAtFront: $("keepManagedGroupsAtFront").checked,
        ungroupSingletonManagedGroups: $("ungroupSingletonManagedGroups").checked,
        ignoreInitialTabUrl: $("ignoreInitialTabUrl").checked,
        commonMultipartSuffixes: $("commonMultipartSuffixes").value,
        excludedFromRootCollapse: $("excludedFromRootCollapse").value,
        ignoredHostnames: $("ignoredHostnames").value,
        customDomainGroups: customGroupsState.map((group) => ({
            title: String(group?.title ?? ""),
            domainsText: String(group?.domainsText ?? ""),
            color: String(group?.color ?? ""),
        })),
    });
}

function hasUnsavedChanges() {
    return captureUiSnapshot() !== savedSnapshot;
}

function setStatus(message, state = "neutral") {
    const status = $("status");
    status.textContent = message;
    status.dataset.state = state;
}

function updateSaveState(customMessage = null) {
    if (loading) return;

    const errors = validateSettings();
    const dirty = hasUnsavedChanges();
    const saveBlocked = errors.length > 0 || jsonDraftDirty;
    $("save").disabled = !dirty || saveBlocked;

    if (customMessage) {
        setStatus(customMessage.message, customMessage.state);
    } else if (errors.length) {
        setStatus(`${errors.length} ${errors.length === 1 ? "issue needs" : "issues need"} attention before saving.`, "error");
    } else if (jsonDraftDirty) {
        setStatus("Raw JSON has unapplied changes.", "warning");
    } else if (dirty) {
        setStatus("Unsaved changes.", "warning");
    } else {
        setStatus("No unsaved changes.", "neutral");
    }
}

function syncAdvancedJsonFromUi({ force = false } = {}) {
    if (jsonDraftDirty && !force) return;
    $("customDomainGroupsJson").value = JSON.stringify(buildGroupsForRawJson(customGroupsState), null, 2);
    jsonDraftDirty = false;
    setValidationMessage($("customDomainGroupsJsonStatus"));
}

function updateSelectedGroupFromInputs() {
    const current = customGroupsState[selectedGroupIndex];
    if (!current) return;

    current.title = $("groupTitle").value;
    current.domainsText = $("groupDomains").value;
    current.color = String($("groupColor").value || "").trim().toLowerCase();
}

function bundleNeedsAttention(group) {
    return !String(group?.title ?? "").trim() || parseDomainsTextarea(group?.domainsText ?? "").invalidEntries.length > 0;
}

function renderSelectedGroup() {
    const current = customGroupsState[selectedGroupIndex];
    const disabled = !current;

    $("groupTitle").value = current?.title ?? "";
    $("groupDomains").value = current?.domainsText ?? "";
    $("groupColor").value = current?.color ?? "";

    $("groupTitle").disabled = disabled;
    $("groupDomains").disabled = disabled;
    $("groupColor").disabled = disabled;
    $("removeGroup").disabled = disabled;
}

function renderGroupSelect() {
    const select = $("customGroupSelect");
    select.innerHTML = "";

    customGroupsState.forEach((group, index) => {
        const option = document.createElement("option");
        const title = String(group?.title ?? "").trim() || `Untitled bundle ${index + 1}`;
        option.value = String(index);
        option.textContent = bundleNeedsAttention(group) ? `${title} — needs attention` : title;
        select.appendChild(option);
    });

    const hasGroups = customGroupsState.length > 0;
    $("bundleEmptyState").hidden = hasGroups;
    $("bundleEditorInterface").hidden = !hasGroups;

    if (!hasGroups) {
        selectedGroupIndex = -1;
        renderSelectedGroup();
        syncAdvancedJsonFromUi();
        return;
    }

    if (selectedGroupIndex < 0 || selectedGroupIndex >= customGroupsState.length) {
        selectedGroupIndex = 0;
    }

    select.value = String(selectedGroupIndex);
    renderSelectedGroup();
    syncAdvancedJsonFromUi();
}

function setGroupsState(groups, preferredIndex = 0) {
    customGroupsState = Array.isArray(groups) ? groups.map((group) => ({
        title: String(group?.title ?? ""),
        domainsText: String(group?.domainsText ?? domainsToLines(group?.domains ?? [])),
        color: VALID_GROUP_COLORS.has(String(group?.color ?? "").trim().toLowerCase())
            ? String(group.color).trim().toLowerCase()
            : "",
    })) : [];

    selectedGroupIndex = customGroupsState.length
        ? Math.max(0, Math.min(preferredIndex, customGroupsState.length - 1))
        : -1;
    renderGroupSelect();
}

function getNextBundleTitle() {
    const base = "New bundle";
    const existing = new Set(customGroupsState.map((group) => String(group?.title || "").trim()));
    if (!existing.has(base)) return base;

    let index = 2;
    while (existing.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
}

function handleStructuredEdit({ refreshSelectLabel = false } = {}) {
    updateSelectedGroupFromInputs();
    if (refreshSelectLabel) {
        const option = $("customGroupSelect").options[selectedGroupIndex];
        const group = customGroupsState[selectedGroupIndex];
        if (option && group) {
            const title = String(group.title || "").trim() || `Untitled bundle ${selectedGroupIndex + 1}`;
            option.textContent = bundleNeedsAttention(group) ? `${title} — needs attention` : title;
        }
    }
    syncAdvancedJsonFromUi();
    updateSaveState();
}

function addGroup() {
    updateSelectedGroupFromInputs();
    customGroupsState.push({ title: getNextBundleTitle(), domainsText: "", color: "" });
    selectedGroupIndex = customGroupsState.length - 1;
    pendingDeletion = null;
    $("undoDelete").hidden = true;
    renderGroupSelect();
    updateSaveState();
    $("groupTitle").focus();
    $("groupTitle").select();
}

function removeSelectedGroup() {
    if (selectedGroupIndex < 0 || selectedGroupIndex >= customGroupsState.length) return;

    updateSelectedGroupFromInputs();
    const [removedGroup] = customGroupsState.splice(selectedGroupIndex, 1);
    pendingDeletion = { group: removedGroup, index: selectedGroupIndex };
    $("undoDelete").hidden = false;

    if (customGroupsState.length === 0) selectedGroupIndex = -1;
    else if (selectedGroupIndex >= customGroupsState.length) selectedGroupIndex = customGroupsState.length - 1;

    renderGroupSelect();
    updateSaveState({ message: `“${String(removedGroup.title || "Untitled bundle").trim()}” deleted. Save changes to apply.`, state: "warning" });
}

function undoDeletion() {
    if (!pendingDeletion) return;

    const index = Math.max(0, Math.min(pendingDeletion.index, customGroupsState.length));
    customGroupsState.splice(index, 0, pendingDeletion.group);
    selectedGroupIndex = index;
    pendingDeletion = null;
    $("undoDelete").hidden = true;
    renderGroupSelect();
    updateSaveState({ message: "Bundle deletion undone.", state: "neutral" });
}

function applyJsonToEditor() {
    try {
        const parsed = JSON.parse($("customDomainGroupsJson").value || "[]");
        const groups = coerceGroupsFromJson(parsed);
        jsonDraftDirty = false;
        setGroupsState(groups, 0);
        setValidationMessage($("customDomainGroupsJsonStatus"), "JSON applied to the editor. Save changes to persist it.", "valid");
        updateSaveState({ message: "JSON applied to the editor. Save changes to persist it.", state: "warning" });
    } catch (error) {
        setValidationMessage($("customDomainGroupsJsonStatus"), `JSON error: ${error.message}`, "error");
        updateSaveState();
    }
}

function discardJsonEdits() {
    syncAdvancedJsonFromUi({ force: true });
    updateSaveState({ message: "Raw JSON edits discarded.", state: "neutral" });
}

function populateForm(settings) {
    $("minTabsToGroup").value = String(settings.minTabsToGroup ?? DEFAULTS.minTabsToGroup);
    $("collapseOtherGroupsOnNavEvents").checked = !!settings.collapseOtherGroupsOnNavEvents;
    $("keepManagedGroupsAtFront").checked = !!settings.keepManagedGroupsAtFront;
    $("ungroupSingletonManagedGroups").checked = !!settings.ungroupSingletonManagedGroups;
    $("ignoreInitialTabUrl").checked = !!settings.ignoreInitialTabUrlForGrouping
        && !!settings.ignoreInitialTabUrlForEnforcement;
    $("commonMultipartSuffixes").value = arrayToLines(settings.commonMultipartSuffixes ?? DEFAULTS.commonMultipartSuffixes);
    $("excludedFromRootCollapse").value = arrayToLines(settings.excludedFromRootCollapse ?? DEFAULTS.excludedFromRootCollapse);
    $("ignoredHostnames").value = arrayToLines(settings.ignoredHostnames ?? DEFAULTS.ignoredHostnames);

    jsonDraftDirty = false;
    pendingDeletion = null;
    $("undoDelete").hidden = true;
    setGroupsState(normalizeStoredGroups(settings.customDomainGroups ?? DEFAULTS.customDomainGroups));
    syncAdvancedJsonFromUi({ force: true });
}

async function load() {
    loading = true;
    const stored = await chrome.storage.sync.get(DEFAULTS);
    populateForm(stored);
    savedSnapshot = captureUiSnapshot();
    loading = false;
    updateSaveState();
}

async function save() {
    updateSelectedGroupFromInputs();
    const errors = validateSettings();
    if (errors.length || jsonDraftDirty) {
        updateSaveState();
        return;
    }

    const commonMultipartSuffixes = parseHostnameRulesTextarea($("commonMultipartSuffixes").value);
    const excludedFromRootCollapse = parseHostnameRulesTextarea($("excludedFromRootCollapse").value);
    const ignoredHostnames = parseHostnameRulesTextarea($("ignoredHostnames").value);
    const payload = {
        minTabsToGroup: Number($("minTabsToGroup").value),
        collapseOtherGroupsOnNavEvents: $("collapseOtherGroupsOnNavEvents").checked,
        keepManagedGroupsAtFront: $("keepManagedGroupsAtFront").checked,
        ungroupSingletonManagedGroups: $("ungroupSingletonManagedGroups").checked,
        // Keep the legacy storage keys aligned for backward compatibility.
        ignoreInitialTabUrlForGrouping: $("ignoreInitialTabUrl").checked,
        ignoreInitialTabUrlForEnforcement: $("ignoreInitialTabUrl").checked,
        commonMultipartSuffixes: commonMultipartSuffixes.validHostnames,
        excludedFromRootCollapse: excludedFromRootCollapse.validHostnames,
        ignoredHostnames: ignoredHostnames.validHostnames,
        customDomainGroups: buildGroupsForPersistence(customGroupsState),
    };

    $("save").disabled = true;
    setStatus("Saving…", "neutral");

    try {
        await chrome.storage.sync.set(payload);
        populateForm(payload);
        savedSnapshot = captureUiSnapshot();
        updateSaveState({ message: "Changes saved.", state: "valid" });
    } catch (error) {
        console.error("Failed to save SumTabs settings", error);
        updateSaveState({ message: "Could not save changes. Try again.", state: "error" });
    }
}

function loadDefaultsIntoEditor() {
    const confirmed = window.confirm(
        "Load the default settings into this page?\n\nNothing will be changed until you select Save changes."
    );
    if (!confirmed) return;

    populateForm(DEFAULTS);
    updateSaveState({ message: "Defaults loaded. Save changes to apply them.", state: "warning" });
}

function bindEvents() {
    const simpleFields = [
        "minTabsToGroup",
        "collapseOtherGroupsOnNavEvents",
        "keepManagedGroupsAtFront",
        "ungroupSingletonManagedGroups",
        "ignoreInitialTabUrl",
        "commonMultipartSuffixes",
        "excludedFromRootCollapse",
        "ignoredHostnames",
    ];

    for (const id of simpleFields) {
        $(id).addEventListener("input", () => updateSaveState());
        $(id).addEventListener("change", () => updateSaveState());
    }

    $("customGroupSelect").addEventListener("change", (event) => {
        updateSelectedGroupFromInputs();
        selectedGroupIndex = Number(event.target.value);
        renderSelectedGroup();
        updateSaveState();
    });

    $("groupTitle").addEventListener("input", () => handleStructuredEdit({ refreshSelectLabel: true }));
    $("groupDomains").addEventListener("input", () => handleStructuredEdit());
    $("groupColor").addEventListener("change", () => handleStructuredEdit());

    $("addGroup").addEventListener("click", addGroup);
    $("createFirstGroup").addEventListener("click", addGroup);
    $("removeGroup").addEventListener("click", removeSelectedGroup);
    $("undoDelete").addEventListener("click", undoDeletion);

    $("customDomainGroupsJson").addEventListener("input", () => {
        jsonDraftDirty = true;
        setValidationMessage($("customDomainGroupsJsonStatus"), "JSON edits have not been applied to the structured editor.", "warning");
        updateSaveState();
    });
    $("applyCustomDomainGroupsJson").addEventListener("click", applyJsonToEditor);
    $("resetCustomDomainGroupsJson").addEventListener("click", discardJsonEdits);

    $("save").addEventListener("click", () => {
        save().catch((error) => {
            console.error("Failed to save SumTabs settings", error);
            updateSaveState({ message: "Could not save changes. Try again.", state: "error" });
        });
    });
    $("reset").addEventListener("click", loadDefaultsIntoEditor);

    window.addEventListener("beforeunload", (event) => {
        if (!hasUnsavedChanges() && !jsonDraftDirty) return;
        event.preventDefault();
        event.returnValue = "";
    });
}

bindEvents();
load().catch((error) => {
    loading = false;
    console.error("Failed to load SumTabs settings", error);
    setStatus("Could not load settings. Reload this page to try again.", "error");
});
