import { DEFAULTS } from "./defaults.js";

const $ = (id) => document.getElementById(id);

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

async function load() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    $("collapseOtherGroupsOnNavEvents").checked = !!stored.collapseOtherGroupsOnNavEvents;
    $("ignoreInitialTabUrlForGrouping").checked = !!stored.ignoreInitialTabUrlForGrouping;
    $("ignoreInitialTabUrlForEnforcement").checked = !!stored.ignoreInitialTabUrlForEnforcement;

    $("commonMultipartSuffixes").value = arrayToLines(stored.commonMultipartSuffixes);
    $("excludedFromRootCollapse").value = arrayToLines(stored.excludedFromRootCollapse);

    $("customDomainGroups").value = JSON.stringify(stored.customDomainGroups ?? DEFAULTS.customDomainGroups, null, 2);
}

async function save() {
    let customGroups;
    try {
        customGroups = JSON.parse($("customDomainGroups").value || "[]");
        if (!Array.isArray(customGroups)) throw new Error("customDomainGroups must be an array");
    } catch (e) {
        setStatus(`Custom bundles JSON error: ${e.message}`, false);
        return;
    }

    const payload = {
        collapseOtherGroupsOnNavEvents: $("collapseOtherGroupsOnNavEvents").checked,
        ignoreInitialTabUrlForGrouping: $("ignoreInitialTabUrlForGrouping").checked,
        ignoreInitialTabUrlForEnforcement: $("ignoreInitialTabUrlForEnforcement").checked,
        commonMultipartSuffixes: linesToArray($("commonMultipartSuffixes").value),
        excludedFromRootCollapse: linesToArray($("excludedFromRootCollapse").value),
        customDomainGroups: customGroups,
    };

    await chrome.storage.sync.set(payload);
    setStatus("Saved.");
}

async function reset() {
    await chrome.storage.sync.set(DEFAULTS);
    await load();
    setStatus("Reset to defaults.");
}

$("save").addEventListener("click", save);
$("reset").addEventListener("click", reset);
load();
