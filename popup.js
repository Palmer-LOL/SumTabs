import { DEFAULTS } from "./defaults.js";
import { buildCustomBundleMaps, getDomainWideSeparationRule, resolveGroupingForHostname } from "./grouping.js";

const activeHostnameEl = document.getElementById("activeHostname");
const groupingTargetEl = document.getElementById("groupingTarget");
const groupingExplanationEl = document.getElementById("groupingExplanation");
const quickActionsCardEl = document.getElementById("quickActionsCard");
const exactActionRowEl = document.getElementById("exactActionRow");
const exactActionLabelEl = document.getElementById("exactActionLabel");
const exactActionStatusEl = document.getElementById("exactActionStatus");
const toggleExactActionButton = document.getElementById("toggleExactAction");
const domainActionRowEl = document.getElementById("domainActionRow");
const domainActionLabelEl = document.getElementById("domainActionLabel");
const domainActionStatusEl = document.getElementById("domainActionStatus");
const toggleDomainActionButton = document.getElementById("toggleDomainAction");
const closeAllInWindowButton = document.getElementById("closeAllInWindow");
const forceReevaluateButton = document.getElementById("forceReevaluate");

let quickActionContext = null;
let quickActionInFlight = false;

function normalizeLowerList(values) {
    return new Set(Array.from(values ?? []).map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean));
}

function normalizeLowerArray(values) {
    return [...normalizeLowerList(values)];
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

function tabTargetLabel(tab, grouping) {
    if (tab.pinned) return "Not grouped";
    return getGroupingTargetLabel(grouping);
}

function setActionState({
    row,
    label,
    status,
    button,
    buttonText,
    hidden = false,
    disabled = false,
}) {
    row.hidden = hidden;
    if (hidden) return;

    label.textContent = status.label;
    status.element.textContent = status.message;
    button.textContent = buttonText;
    button.disabled = disabled || quickActionInFlight;
}

function renderQuickActions(context) {
    quickActionContext = context;

    if (!context) {
        quickActionsCardEl.hidden = true;
        exactActionRowEl.hidden = true;
        domainActionRowEl.hidden = true;
        return;
    }

    quickActionsCardEl.hidden = false;

    setActionState({
        row: exactActionRowEl,
        label: exactActionLabelEl,
        status: {
            element: exactActionStatusEl,
            label: `Separate only ${context.hostname}`,
            message: context.exactActionEnabled
                ? `${context.hostname} is already listed in exact-host separation rules.`
                : `Add ${context.hostname} to exact-host separation rules.`,
        },
        button: toggleExactActionButton,
        buttonText: context.exactActionEnabled ? "Remove rule" : "Add rule",
    });

    setActionState({
        row: domainActionRowEl,
        label: domainActionLabelEl,
        status: {
            element: domainActionStatusEl,
            label: context.domainActionLabel,
            message: context.domainActionEnabled
                ? (context.domainActionAffectsCurrentTab
                    ? `${context.domainActionToken} is already separating this tab from sibling subdomains.`
                    : `${context.domainActionToken} is already listed in domain-wide separation rules.`)
                : `Add ${context.domainActionToken} so its subdomains stay separate.`,
        },
        button: toggleDomainActionButton,
        buttonText: context.domainActionEnabled ? "Remove rule" : "Add rule",
        hidden: !context.domainActionAvailable,
    });
}

async function updateSyncList(key, updateList) {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    const currentValues = Array.isArray(stored[key]) ? stored[key] : DEFAULTS[key];
    const nextValues = normalizeLowerArray(updateList(currentValues));
    await chrome.storage.sync.set({ [key]: nextValues });
}

async function toggleExactAction() {
    if (!quickActionContext) return;

    quickActionInFlight = true;
    renderQuickActions(quickActionContext);

    try {
        await updateSyncList("excludedFromRootCollapse", (currentValues) => {
            const nextValues = normalizeLowerList(currentValues);
            if (quickActionContext.exactActionEnabled) {
                nextValues.delete(quickActionContext.hostname);
            } else {
                nextValues.add(quickActionContext.hostname);
            }
            return nextValues;
        });

        await renderActiveTabStatus();
    } finally {
        quickActionInFlight = false;
        renderQuickActions(quickActionContext);
    }
}

async function toggleDomainAction() {
    if (!quickActionContext?.domainActionAvailable) return;

    quickActionInFlight = true;
    renderQuickActions(quickActionContext);

    try {
        await updateSyncList("commonMultipartSuffixes", (currentValues) => {
            const nextValues = normalizeLowerList(currentValues);
            if (quickActionContext.domainActionEnabled) {
                nextValues.delete(quickActionContext.domainActionToken);
            } else {
                nextValues.add(quickActionContext.domainActionToken);
            }
            return nextValues;
        });

        await renderActiveTabStatus();
    } finally {
        quickActionInFlight = false;
        renderQuickActions(quickActionContext);
    }
}

async function closeAllUnpinnedTabsInCurrentWindow() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = activeTab?.windowId;
    if (windowId == null) return;

    const tabsInWindow = await chrome.tabs.query({ windowId });
    const pinnedTabs = tabsInWindow.filter((tab) => tab?.pinned === true);
    const unpinnedTabs = tabsInWindow.filter((tab) => tab?.id != null && tab.pinned !== true);

    if (unpinnedTabs.length === 0) return;

    let replacementTabId = null;
    if (pinnedTabs.length === 0) {
        const replacementTab = await chrome.tabs.create({ windowId, active: true });
        replacementTabId = replacementTab?.id ?? null;
    }

    const tabIdsToClose = unpinnedTabs
        .map((tab) => tab.id)
        .filter((tabId) => tabId != null && tabId !== replacementTabId);

    if (tabIdsToClose.length === 0) return;

    await chrome.tabs.remove(tabIdsToClose);
}

async function renderActiveTabStatus() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!activeTab?.url) {
        setStatus({
            hostname: "Unavailable",
            target: "Unavailable",
            explanation: "This tab’s URL is not available right now.",
        });
        renderQuickActions(null);
        return;
    }

    if (!isSupportedTabUrl(activeTab.url)) {
        setStatus({
            hostname: "Unsupported page",
            target: "Not grouped",
            explanation: "This page is not grouped because only web pages can be grouped.",
        });
        renderQuickActions(null);
        return;
    }

    const parsedUrl = new URL(activeTab.url);
    const settings = await chrome.storage.sync.get(DEFAULTS);
    const commonMultipartSuffixes = normalizeLowerList(settings.commonMultipartSuffixes);
    const excludedFromRootCollapse = normalizeLowerList(settings.excludedFromRootCollapse);
    // Mirror the background worker's shared precedence so the popup explanation matches runtime grouping behavior.
    const grouping = resolveGroupingForHostname({
        hostname: parsedUrl.hostname,
        parsedUrl,
        commonMultipartSuffixes,
        excludedFromRootCollapse,
        customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
        managedPrefix: settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix,
    });
    const domainAction = getDomainWideSeparationRule(grouping.hostname, commonMultipartSuffixes);
    const domainActionAvailable = !!domainAction;

    setStatus({
        hostname: grouping.hostname,
        target: tabTargetLabel(activeTab, grouping),
        explanation: getExplanation(activeTab, grouping),
    });

    renderQuickActions({
        hostname: grouping.hostname,
        exactActionEnabled: excludedFromRootCollapse.has(grouping.hostname),
        domainActionAvailable,
        domainActionEnabled: domainActionAvailable && commonMultipartSuffixes.has(domainAction.token),
        domainActionAffectsCurrentTab: domainAction?.affectsHostname ?? false,
        domainActionLabel: domainAction?.label ?? "",
        domainActionToken: domainAction?.token ?? "",
    });
}

document.getElementById("openSettings").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
});

toggleExactActionButton.addEventListener("click", () => {
    toggleExactAction().catch((error) => {
        console.error("Failed to update exact-host separation rule", error);
    });
});

toggleDomainActionButton.addEventListener("click", () => {
    toggleDomainAction().catch((error) => {
        console.error("Failed to update domain-wide separation rule", error);
    });
});


forceReevaluateButton?.addEventListener("click", async () => {
    if (!forceReevaluateButton) return;

    const originalLabel = forceReevaluateButton.textContent;
    forceReevaluateButton.disabled = true;
    forceReevaluateButton.textContent = "Reevaluating…";

    try {
        await chrome.runtime.sendMessage({ type: "sumtabs:force-reevaluate" });
        window.close();
    } catch (error) {
        console.error("Failed to force reevaluation", error);
        forceReevaluateButton.disabled = false;
        forceReevaluateButton.textContent = originalLabel ?? "Reevaluate open tabs now";
    }
});

closeAllInWindowButton?.addEventListener("click", () => {
    const confirmed = window.confirm(
        "Close all unpinned tabs and clear all tab groups in this window only?\n\nPinned tabs will not be touched."
    );

    if (!confirmed) return;

    closeAllUnpinnedTabsInCurrentWindow().then(() => {
        window.close();
    }).catch((error) => {
        console.error("Failed to close unpinned tabs in current window", error);
    });
});

renderActiveTabStatus().catch((error) => {
    console.error("Failed to render popup status", error);
    setStatus({
        hostname: "Unavailable",
        target: "Unavailable",
        explanation: "Could not determine this tab’s grouping status.",
    });
    renderQuickActions(null);
});
