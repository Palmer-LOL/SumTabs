import { DEFAULTS } from "../core/defaults.js";
import { getCustomDomainBundleEntryConflicts } from "../core/grouping.js";
import {
    MIN_GROUPING_THRESHOLD,
    VALID_GROUP_COLORS,
    arrayToLines,
    coerceGroupsFromJson,
    domainsToLines,
    groupsForPersistence,
    groupsForRawJson,
    normalizeStoredGroups,
    parseDomainsTextarea,
    parseHostnameRulesTextarea,
} from "./validation.js";

export function createSettingsEditor({ documentRef }) {
    const $ = (id) => documentRef.getElementById(id);
    let customGroupsState = [];
    let selectedGroupIndex = -1;
    let jsonDraftDirty = false;
    let pendingDeletion = null;

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

        const duplicateMessage = getDuplicateDomainMessage(groupsForPersistence(customGroupsState));
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

    function syncAdvancedJsonFromUi({ force = false } = {}) {
        if (jsonDraftDirty && !force) return;
        $("customDomainGroupsJson").value = JSON.stringify(groupsForRawJson(customGroupsState), null, 2);
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
        return !String(group?.title ?? "").trim()
            || parseDomainsTextarea(group?.domainsText ?? "").invalidEntries.length > 0;
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
            const option = documentRef.createElement("option");
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
            ...structuredClone(group),
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

    function loadDefaultsIntoEditor() {
        populateForm(DEFAULTS);
    }

    function replaceGroupsFromStorage(groups) {
        jsonDraftDirty = false;
        pendingDeletion = null;
        $("undoDelete").hidden = true;
        setGroupsState(normalizeStoredGroups(groups));
        syncAdvancedJsonFromUi({ force: true });
    }

    function getPersistenceValues() {
        updateSelectedGroupFromInputs();
        return {
            minTabsToGroup: Number($("minTabsToGroup").value),
            collapseOtherGroupsOnNavEvents: $("collapseOtherGroupsOnNavEvents").checked,
            keepManagedGroupsAtFront: $("keepManagedGroupsAtFront").checked,
            ungroupSingletonManagedGroups: $("ungroupSingletonManagedGroups").checked,
            // Keep the legacy storage keys aligned for backward compatibility.
            ignoreInitialTabUrlForGrouping: $("ignoreInitialTabUrl").checked,
            ignoreInitialTabUrlForEnforcement: $("ignoreInitialTabUrl").checked,
            commonMultipartSuffixes: parseHostnameRulesTextarea($("commonMultipartSuffixes").value).validHostnames,
            excludedFromRootCollapse: parseHostnameRulesTextarea($("excludedFromRootCollapse").value).validHostnames,
            ignoredHostnames: parseHostnameRulesTextarea($("ignoredHostnames").value).validHostnames,
            customDomainGroups: groupsForPersistence(customGroupsState),
        };
    }

    function bindEditorEvents({ updateSaveState }) {
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

        const handleStructuredEdit = ({ refreshSelectLabel = false } = {}) => {
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
        };

        const addGroup = () => {
            updateSelectedGroupFromInputs();
            customGroupsState.push({ title: getNextBundleTitle(), domainsText: "", color: "" });
            selectedGroupIndex = customGroupsState.length - 1;
            pendingDeletion = null;
            $("undoDelete").hidden = true;
            renderGroupSelect();
            updateSaveState();
            $("groupTitle").focus();
            $("groupTitle").select();
        };

        const removeSelectedGroup = () => {
            if (selectedGroupIndex < 0 || selectedGroupIndex >= customGroupsState.length) return;

            updateSelectedGroupFromInputs();
            const [removedGroup] = customGroupsState.splice(selectedGroupIndex, 1);
            pendingDeletion = { group: removedGroup, index: selectedGroupIndex };
            $("undoDelete").hidden = false;

            if (customGroupsState.length === 0) selectedGroupIndex = -1;
            else if (selectedGroupIndex >= customGroupsState.length) selectedGroupIndex = customGroupsState.length - 1;

            renderGroupSelect();
            updateSaveState({ message: `“${String(removedGroup.title || "Untitled bundle").trim()}” deleted. Save changes to apply.`, state: "warning" });
        };

        const undoDeletion = () => {
            if (!pendingDeletion) return;

            const index = Math.max(0, Math.min(pendingDeletion.index, customGroupsState.length));
            customGroupsState.splice(index, 0, pendingDeletion.group);
            selectedGroupIndex = index;
            pendingDeletion = null;
            $("undoDelete").hidden = true;
            renderGroupSelect();
            updateSaveState({ message: "Bundle deletion undone.", state: "neutral" });
        };

        const applyJsonToEditor = () => {
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
        };

        const discardJsonEdits = () => {
            syncAdvancedJsonFromUi({ force: true });
            updateSaveState({ message: "Raw JSON edits discarded.", state: "neutral" });
        };

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
    }

    return {
        validateSettings,
        captureUiSnapshot,
        hasJsonDraft: () => jsonDraftDirty,
        populateForm,
        loadDefaultsIntoEditor,
        getPersistenceValues,
        bindEditorEvents,
        setGroupsState,
        replaceGroupsFromStorage,
    };
}
