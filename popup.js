import { DEFAULTS } from "./defaults.js";
import { resolveGroupingForHostname } from "./grouping.js";

const activeHostnameEl = document.getElementById("activeHostname");
const groupingTargetEl = document.getElementById("groupingTarget");
const groupingExplanationEl = document.getElementById("groupingExplanation");

function normalizeLowerList(values) {
    return new Set((values ?? []).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean));
}

function buildCustomBundleMaps(customDomainGroups) {
    const exactHostnameToBundleTitle = new Map();
    const groupKeyToBundleTitle = new Map();

    for (const group of customDomainGroups ?? []) {
        if (!group?.title || !Array.isArray(group.domains)) continue;

        const title = String(group.title).trim();
        if (!title) continue;

        for (const domain of group.domains) {
            const normalizedDomain = String(domain ?? "").trim().toLowerCase();
            if (!normalizedDomain) continue;
            exactHostnameToBundleTitle.set(normalizedDomain, title);
            groupKeyToBundleTitle.set(normalizedDomain, title);
        }
    }

    return { exactHostnameToBundleTitle, groupKeyToBundleTitle };
}

function isSupportedTabUrl(tabUrl) {
    if (!tabUrl) return false;

    try {
        const parsedUrl = new URL(tabUrl);
        return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
        return false;
    }
}

function getGroupingTargetLabel(grouping) {
    if (grouping.reason === "custom-bundle-grouping") return grouping.identity;
    return grouping.displayGroupingLabel;
}

function getExplanation(tab, grouping) {
    if (tab.pinned) {
        return "This tab is separate because pinned tabs are never grouped.";
    }

    switch (grouping.reason) {
        case "custom-bundle-grouping":
            return `This tab is grouped under the custom bundle ${grouping.identity}.`;
        case "exact-host-separation":
            return `This tab is separate because ${grouping.hostname} is set to stay separate.`;
        case "multipart-suffix-separation":
            return `This tab is separate because ${grouping.matchedSuffix} is set to treat subdomains independently.`;
        case "default-root-domain-grouping":
        default:
            return `This tab is grouped with ${grouping.displayGroupingLabel} by default.`;
    }
}

function setStatus({ hostname, target, explanation }) {
    activeHostnameEl.textContent = hostname;
    groupingTargetEl.textContent = target;
    groupingExplanationEl.textContent = explanation;
}

async function renderActiveTabStatus() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab?.url) {
        setStatus({
            hostname: "Unavailable",
            target: "Unavailable",
            explanation: "This tab’s URL is not available right now.",
        });
        return;
    }

    if (!isSupportedTabUrl(activeTab.url)) {
        setStatus({
            hostname: "Unsupported page",
            target: "Not grouped",
            explanation: "This page is not grouped because only web pages can be grouped.",
        });
        return;
    }

    const parsedUrl = new URL(activeTab.url);
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const grouping = resolveGroupingForHostname({
        hostname: parsedUrl.hostname,
        commonMultipartSuffixes: normalizeLowerList(settings.commonMultipartSuffixes),
        excludedFromRootCollapse: normalizeLowerList(settings.excludedFromRootCollapse),
        customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
        managedPrefix: settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix,
    });

    setStatus({
        hostname: grouping.hostname,
        target: tabTargetLabel(activeTab, grouping),
        explanation: getExplanation(activeTab, grouping),
    });
}

function tabTargetLabel(tab, grouping) {
    if (tab.pinned) return "Not grouped";
    return getGroupingTargetLabel(grouping);
}

document.getElementById("openSettings").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
});

renderActiveTabStatus().catch((error) => {
    console.error("Failed to render popup status", error);
    setStatus({
        hostname: "Unavailable",
        target: "Unavailable",
        explanation: "Could not determine this tab’s grouping status.",
    });
});
