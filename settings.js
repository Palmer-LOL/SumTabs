import { DEFAULTS } from "./defaults.js";

const $ = (id) => document.getElementById(id);

let customGroupsState = [];
let selectedGroupIndex = 0;
const VALID_GROUP_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function domainsToLines(domains) {
    return (domains || [])
    .map(d => String(d).trim().toLowerCase())
    .filter(Boolean)
    .join("\n");
}

function linesToDomains(text) {
    return (text || "")
    .split(/\r?\n/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeCustomGroups(groups) {
    if (!Array.isArray(groups)) return [];
    const out = [];
    for (const g of groups) {
        const title = String(g?.title ?? "").trim();
        const domains = Array.isArray(g?.domains) ? g.domains : [];
        const normDomains = domains
        .map(d => String(d).trim().toLowerCase())
        .filter(Boolean);
        const color = String(g?.color ?? "").trim().toLowerCase();

        if (!title) continue;
        out.push({
            title,
            domains: normDomains,
            ...(VALID_GROUP_COLORS.has(color) ? { color } : {}),
        });
    }
    return out;
}

function linesToArray(text) {
    return text
    .split(/\r?\n/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function arrayToLines(arr) {
    return (arr || []).join("\n");
}

function setStatus(msg, ok = true) {
    const el = $("status");
    el.textContent = msg;
    el.style.color = ok ? "green" : "crimson";
    setTimeout(() => { el.textContent = ""; }, 2500);
}

function getNextBundleTitle() {
    const base = "New bundle";
    const existing = new Set(customGroupsState.map(g => String(g?.title || "").trim()));
    if (!existing.has(base)) return base;

    let i = 2;
    while (existing.has(`${base} ${i}`)) i += 1;
    return `${base} ${i}`;
}

function updateSelectedGroupFromInputs() {
    const current = customGroupsState[selectedGroupIndex];
    if (!current) return;
    current.title = $("groupTitle").value.trim();
    current.domains = linesToDomains($("groupDomains").value);
    current.color = String($("groupColor").value || "").trim().toLowerCase();
}

function renderSelectedGroup() {
    const current = customGroupsState[selectedGroupIndex];
    $("groupTitle").value = current?.title ?? "";
    $("groupDomains").value = domainsToLines(current?.domains ?? []);
    $("groupColor").value = current?.color ?? "";

    const disabled = !current;
    $("groupTitle").disabled = disabled;
    $("groupDomains").disabled = disabled;
    $("groupColor").disabled = disabled;
    $("removeGroup").disabled = disabled;
}

function renderGroupSelect() {
    const select = $("customGroupSelect");
    select.innerHTML = "";

    customGroupsState.forEach((group, i) => {
        const option = document.createElement("option");
        const title = String(group.title || "").trim() || `Untitled bundle ${i + 1}`;
        option.value = String(i);
        option.textContent = title;
        select.appendChild(option);
    });

    if (customGroupsState.length === 0) {
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
    customGroupsState = Array.isArray(groups)
    ? groups.map((g) => ({
        title: String(g?.title ?? "").trim(),
        domains: linesToDomains(domainsToLines(g?.domains ?? [])),
        color: VALID_GROUP_COLORS.has(String(g?.color ?? "").trim().toLowerCase()) ? String(g.color).trim().toLowerCase() : "",
    }))
    : [];

    selectedGroupIndex = customGroupsState.length ? Math.max(0, Math.min(preferredIndex, customGroupsState.length - 1)) : -1;
    renderGroupSelect();
}

function readGroupsFromUi() {
    updateSelectedGroupFromInputs();
    return normalizeCustomGroups(customGroupsState);
}

function syncAdvancedJsonFromUi() {
    const el = $("customDomainGroupsJson");
    if (!el) return;
    const groups = readGroupsFromUi();
    el.value = JSON.stringify(groups, null, 2);
}

async function load() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    $("collapseOtherGroupsOnNavEvents").checked = !!stored.collapseOtherGroupsOnNavEvents;
    // Default (false): keep singleton managed groups grouped. Enabled (true): ungroup them.
    $("ungroupSingletonManagedGroups").checked = !!stored.ungroupSingletonManagedGroups;
    $("ignoreInitialTabUrlForGrouping").checked = !!stored.ignoreInitialTabUrlForGrouping;
    $("ignoreInitialTabUrlForEnforcement").checked = !!stored.ignoreInitialTabUrlForEnforcement;

    // Keep legacy storage keys; the UI now describes these as separation rules.
    $("commonMultipartSuffixes").value = arrayToLines(stored.commonMultipartSuffixes);
    $("excludedFromRootCollapse").value = arrayToLines(stored.excludedFromRootCollapse);

    const loadedGroups = normalizeCustomGroups(stored.customDomainGroups ?? DEFAULTS.customDomainGroups);
    setGroupsState(loadedGroups.length ? loadedGroups : [{ title: "", domains: [] }]);

    const adv = $("customDomainGroupsJson");
    if (adv) {
        adv.addEventListener("change", () => {
            try {
                const parsed = JSON.parse(adv.value || "[]");
                const normalized = normalizeCustomGroups(parsed);
                setGroupsState(normalized.length ? normalized : [{ title: "", domains: [] }]);
                setStatus("Loaded bundles from JSON.");
            } catch (e) {
                setStatus(`Advanced JSON error: ${e.message}`, false);
            }
        });
    }
}

async function save() {

    const customGroups = readGroupsFromUi();

    const payload = {
        collapseOtherGroupsOnNavEvents: $("collapseOtherGroupsOnNavEvents").checked,
        // Persist singleton managed-group policy exactly as represented in the settings checkbox.
        ungroupSingletonManagedGroups: $("ungroupSingletonManagedGroups").checked,
        ignoreInitialTabUrlForGrouping: $("ignoreInitialTabUrlForGrouping").checked,
        ignoreInitialTabUrlForEnforcement: $("ignoreInitialTabUrlForEnforcement").checked,
        // Keep the stored key names backward-compatible with existing sync data.
        commonMultipartSuffixes: linesToArray($("commonMultipartSuffixes").value),
        excludedFromRootCollapse: linesToArray($("excludedFromRootCollapse").value),
        customDomainGroups: customGroups,
    };

    await chrome.storage.sync.set(payload);
    setStatus("Saved.");
    setGroupsState(customGroups.length ? customGroups : [{ title: "", domains: [] }], selectedGroupIndex);
}

async function reset() {
    await chrome.storage.sync.set(DEFAULTS);
    await load();
    setStatus("Reset to defaults.");
}

$("customGroupSelect").addEventListener("change", (event) => {
    updateSelectedGroupFromInputs();
    selectedGroupIndex = Number(event.target.value);
    renderSelectedGroup();
    syncAdvancedJsonFromUi();
});

$("groupTitle").addEventListener("input", () => {
    updateSelectedGroupFromInputs();
    renderGroupSelect();
});

$("groupDomains").addEventListener("input", () => {
    updateSelectedGroupFromInputs();
    syncAdvancedJsonFromUi();
});

$("groupColor").addEventListener("change", () => {
    updateSelectedGroupFromInputs();
    syncAdvancedJsonFromUi();
});

$("addGroup").addEventListener("click", () => {
    updateSelectedGroupFromInputs();
    customGroupsState.push({ title: getNextBundleTitle(), domains: [], color: "" });
    selectedGroupIndex = customGroupsState.length - 1;
    renderGroupSelect();
    $("groupTitle").focus();
    $("groupTitle").select();
});

$("removeGroup").addEventListener("click", () => {
    if (selectedGroupIndex < 0 || selectedGroupIndex >= customGroupsState.length) return;

    customGroupsState.splice(selectedGroupIndex, 1);
    if (customGroupsState.length === 0) {
        customGroupsState.push({ title: "", domains: [], color: "" });
        selectedGroupIndex = 0;
    } else if (selectedGroupIndex >= customGroupsState.length) {
        selectedGroupIndex = customGroupsState.length - 1;
    }

    renderGroupSelect();
});

$("save").addEventListener("click", save);
$("reset").addEventListener("click", reset);
load();
