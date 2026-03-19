import { DEFAULTS } from "./defaults.js";

const addDistinctSubdomainButton = document.getElementById("addDistinctSubdomain");
const openSettingsButton = document.getElementById("openSettings");
const popupDescription = document.getElementById("popupDescription");
const popupStatus = document.getElementById("popupStatus");

let currentContext = null;

function setStatus(message, ok = true) {
    popupStatus.textContent = message;
    popupStatus.style.color = ok ? "green" : "crimson";
}

function deriveDistinctSubdomainEntry(hostname) {
    const parts = String(hostname || "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);

    if (parts.length <= 2) return null;
    return parts.slice(1).join(".");
}

function setUnavailableState(message) {
    addDistinctSubdomainButton.disabled = true;
    popupDescription.textContent = message;
}

openSettingsButton.addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
});

addDistinctSubdomainButton.addEventListener("click", async () => {
    if (!currentContext?.entry) return;

    const stored = await chrome.storage.sync.get(DEFAULTS);
    const existing = new Set((stored.commonMultipartSuffixes || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));

    if (existing.has(currentContext.entry)) {
        setStatus(`Already saved: ${currentContext.entry}`);
        return;
    }

    existing.add(currentContext.entry);
    await chrome.storage.sync.set({
        commonMultipartSuffixes: Array.from(existing),
    });

    setStatus(`Saved: ${currentContext.entry}`);
});

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const rawUrl = tab?.url || tab?.pendingUrl;

    if (!rawUrl) {
        setUnavailableState("Open an HTTP(S) page to add a distinct subdomain shortcut.");
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        setUnavailableState("Current page URL could not be read.");
        return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        setUnavailableState("Only HTTP(S) pages can be added here.");
        return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const entry = deriveDistinctSubdomainEntry(hostname);
    if (!entry) {
        setUnavailableState(`${hostname} is already grouped as its own root domain.`);
        return;
    }

    currentContext = { hostname, entry };
    popupDescription.textContent = `Adds ${entry} to Distinct Subdomains so ${hostname} stays separate when possible.`;
}

init();
