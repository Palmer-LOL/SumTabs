import { DEFAULTS } from "./defaults.js";

const $ = (id) => document.getElementById(id);

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

        if (!title) continue;
        out.push({ title, domains: normDomains });
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

function createGroupCard(group = { title: "", domains: [] }) {
    const wrapper = document.createElement("div");
    wrapper.className = "groupCard";

    wrapper.innerHTML = `
    <div class="row2">
    <label>Bundle title</label>
    <input type="text" class="groupTitle" placeholder="e.g., News" value="">
    </div>

    <div class="row2">
    <label>Domains (one per line)</label>
    <textarea class="groupDomains" placeholder="nytimes.com\ntheatlantic.com"></textarea>
    </div>

    <button type="button" class="removeGroup danger">Remove</button>
    `;

    wrapper.querySelector(".groupTitle").value = group.title ?? "";
    wrapper.querySelector(".groupDomains").value = domainsToLines(group.domains ?? []);

    wrapper.querySelector(".removeGroup").addEventListener("click", () => {
        wrapper.remove();
        syncAdvancedJsonFromUi();
    });

    // keep Advanced JSON in sync as the user types (nice for debugging)
    wrapper.querySelector(".groupTitle").addEventListener("input", syncAdvancedJsonFromUi);
    wrapper.querySelector(".groupDomains").addEventListener("input", syncAdvancedJsonFromUi);

    return wrapper;
}

function readGroupsFromUi() {
    const container = $("customGroups");
    const cards = Array.from(container.querySelectorAll(".groupCard"));

    const groups = cards.map(card => {
        const title = card.querySelector(".groupTitle").value.trim();
        const domains = linesToDomains(card.querySelector(".groupDomains").value);
        return { title, domains };
    });

    return normalizeCustomGroups(groups);
}

function renderGroupsEditor(groups) {
    const container = $("customGroups");
    container.innerHTML = "";
    for (const g of normalizeCustomGroups(groups)) {
        container.appendChild(createGroupCard(g));
    }
    // If there are none, start with an empty card (optional)
    if (!container.children.length) container.appendChild(createGroupCard());
    syncAdvancedJsonFromUi();
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
    $("ignoreInitialTabUrlForGrouping").checked = !!stored.ignoreInitialTabUrlForGrouping;
    $("ignoreInitialTabUrlForEnforcement").checked = !!stored.ignoreInitialTabUrlForEnforcement;

    $("commonMultipartSuffixes").value = arrayToLines(stored.commonMultipartSuffixes);
    $("excludedFromRootCollapse").value = arrayToLines(stored.excludedFromRootCollapse);

    renderGroupsEditor(stored.customDomainGroups ?? DEFAULTS.customDomainGroups);

    const adv = $("customDomainGroupsJson");
    if (adv) {
        adv.addEventListener("change", () => {
            try {
                const parsed = JSON.parse(adv.value || "[]");
                renderGroupsEditor(parsed);
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

$("addGroup").addEventListener("click", () => {
    $("customGroups").appendChild(createGroupCard());
    syncAdvancedJsonFromUi();
});

$("save").addEventListener("click", save);
$("reset").addEventListener("click", reset);
load();
