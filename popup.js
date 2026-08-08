import { DEFAULTS } from "./defaults.js";
import {
	buildCustomBundleMaps,
	getCustomDomainBundleEntryOwners,
	getDomainWideSeparationRule,
	resolveGroupingForHostname,
} from "./grouping.js";

const activeHostnameEl = document.getElementById("activeHostname");
const groupingTargetEl = document.getElementById("groupingTarget");
const groupingExplanationEl = document.getElementById("groupingExplanation");
const quickActionsCardEl = document.getElementById("quickActionsCard");
const popupFeedbackEl = document.getElementById("popupFeedback");
const popupHeaderActionsEl = document.querySelector(".popup__header-actions");
const ignoreActionRowEl = document.getElementById("ignoreActionRow");
const ignoreActionLabelEl = document.getElementById("ignoreActionLabel");
const ignoreActionStatusEl = document.getElementById("ignoreActionStatus");
const toggleIgnoreActionButton = document.getElementById("toggleIgnoreAction");
const exactActionRowEl = document.getElementById("exactActionRow");
const exactActionLabelEl = document.getElementById("exactActionLabel");
const exactActionStatusEl = document.getElementById("exactActionStatus");
const toggleExactActionButton = document.getElementById("toggleExactAction");
const domainActionRowEl = document.getElementById("domainActionRow");
const domainActionLabelEl = document.getElementById("domainActionLabel");
const domainActionStatusEl = document.getElementById("domainActionStatus");
const toggleDomainActionButton = document.getElementById("toggleDomainAction");
const bundleActionRowEl = document.getElementById("bundleActionRow");
const bundleSelectEl = document.getElementById("bundleSelect");
const bundleActionStatusEl = document.getElementById("bundleActionStatus");
const applyBundleActionButton = document.getElementById("applyBundleAction");
const removeBundleActionButton = document.getElementById("removeBundleAction");
const closeAllInWindowButton = document.getElementById("closeAllInWindow");
const forceReevaluateButton = document.getElementById("forceReevaluate");

let quickActionContext = null;
let quickActionInFlight = false;

function announcePopupFeedback(message) {
	if (!popupFeedbackEl) return;
	popupFeedbackEl.textContent = message;
}

function setQuickActionBusy(isBusy, message = "") {
	quickActionInFlight = isBusy;
	quickActionsCardEl?.setAttribute("aria-busy", String(isBusy));
	if (message) announcePopupFeedback(message);
}

function setReapplyBusy(isBusy, message = "") {
	popupHeaderActionsEl?.setAttribute("aria-busy", String(isBusy));
	if (message) announcePopupFeedback(message);
}

async function requestForceReevaluate() {
	const response = await chrome.runtime.sendMessage({
		type: "sumtabs:force-reevaluate",
	});
	if (response?.ok) return response;
	throw new Error(response?.error || "Could not reapply rules.");
}

function normalizeBundleTitle(group, index) {
	return String(group?.title ?? "").trim() || `Untitled bundle ${index + 1}`;
}

function normalizeLowerList(values) {
	return new Set(
		Array.from(values ?? [])
			.map((value) =>
				String(value ?? "")
					.trim()
					.toLowerCase(),
			)
			.filter(Boolean),
	);
}

function normalizeLowerArray(values) {
	return [...normalizeLowerList(values)];
}

function safeParseUrl(urlString) {
	try {
		return new URL(urlString);
	} catch {
		return null;
	}
}

function isWebUrl(u) {
	return u && (u.protocol === "http:" || u.protocol === "https:");
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
		ignoreActionRowEl.hidden = true;
		exactActionRowEl.hidden = true;
		domainActionRowEl.hidden = true;
		bundleActionRowEl.hidden = true;
		return;
	}

	quickActionsCardEl.hidden = false;

	setActionState({
		row: ignoreActionRowEl,
		label: ignoreActionLabelEl,
		status: {
			element: ignoreActionStatusEl,
			label: `Ignore ${context.hostname}`,
			message: context.ignoreActionEnabled
				? `${context.hostname} is ignored and will not be managed by SumTabs.`
				: `Keep ${context.hostname} completely unmanaged.`,
		},
		button: toggleIgnoreActionButton,
		buttonText: context.ignoreActionEnabled ? "Remove rule" : "Add rule",
	});

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
				? context.domainActionAffectsCurrentTab
					? `${context.domainActionToken} is already separating this tab from sibling subdomains.`
					: `${context.domainActionToken} is already listed in domain-wide separation rules.`
				: `Add ${context.domainActionToken} so its subdomains stay separate.`,
		},
		button: toggleDomainActionButton,
		buttonText: context.domainActionEnabled ? "Remove rule" : "Add rule",
		hidden: !context.domainActionAvailable,
	});

	renderBundleAction(context);
}

function renderBundleAction(context) {
	bundleActionRowEl.hidden = false;
	bundleSelectEl.innerHTML = "";

	const bundles = context.customDomainGroups;
	bundles.forEach((group, index) => {
		const option = document.createElement("option");
		option.value = String(index);
		option.textContent = normalizeBundleTitle(group, index);
		bundleSelectEl.appendChild(option);
	});

	const hasBundles = bundles.length > 0;
	bundleSelectEl.disabled = !hasBundles || quickActionInFlight;
	updateBundleSelectionStatus();
}

function getBundleOwnershipLabel(owners) {
	return owners
		.map(
			(owner) => owner.title || `Untitled bundle ${owner.groupIndex + 1}`,
		)
		.join(", ");
}

function updateBundleSelectionStatus() {
	if (!quickActionContext) return;

	const hasBundles = quickActionContext.customDomainGroups.length > 0;
	const selectedIndex = Number(bundleSelectEl.value);
	const isAlreadyInSelectedBundle =
		quickActionContext.bundleMembershipByIndex.has(selectedIndex);
	const isInAnyBundle = quickActionContext.bundleOwners.length > 0;
	const isOnlyInSelectedBundle =
		isAlreadyInSelectedBundle &&
		quickActionContext.bundleOwners.every(
			(owner) => owner.groupIndex === selectedIndex,
		);

	applyBundleActionButton.disabled =
		!hasBundles ||
		isAlreadyInSelectedBundle ||
		isInAnyBundle ||
		quickActionInFlight;
	removeBundleActionButton.disabled =
		!hasBundles || !isAlreadyInSelectedBundle || quickActionInFlight;

	if (!hasBundles) {
		bundleActionStatusEl.textContent =
			"No custom bundles exist yet. Open Settings to create one.";
	} else if (isOnlyInSelectedBundle) {
		bundleActionStatusEl.textContent = `${quickActionContext.hostname} is already in this bundle. Use Remove to take it out.`;
	} else if (isInAnyBundle) {
		bundleActionStatusEl.textContent = `${quickActionContext.hostname} is already in ${getBundleOwnershipLabel(quickActionContext.bundleOwners)}. Remove it there before adding it to another bundle.`;
	} else {
		bundleActionStatusEl.textContent = `Add ${quickActionContext.hostname} to ${normalizeBundleTitle(quickActionContext.customDomainGroups[selectedIndex], selectedIndex)}.`;
	}
}

async function updateSyncList(key, updateList) {
	const stored = await chrome.storage.sync.get(DEFAULTS);
	const currentValues = Array.isArray(stored[key])
		? stored[key]
		: DEFAULTS[key];
	const nextValues = normalizeLowerArray(updateList(currentValues));
	await chrome.storage.sync.set({ [key]: nextValues });
}

async function toggleExactAction() {
	if (!quickActionContext) return;

	const wasEnabled = quickActionContext.exactActionEnabled;
	setQuickActionBusy(true, wasEnabled ? "Removing rule…" : "Adding rule…");
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
		await requestForceReevaluate();

		await renderActiveTabStatus();
		announcePopupFeedback(
			wasEnabled
				? "Rule removed. Open tabs have been reorganized."
				: "Rule added. Open tabs have been reorganized.",
		);
	} finally {
		setQuickActionBusy(false);
		renderQuickActions(quickActionContext);
	}
}

async function toggleIgnoreAction() {
	if (!quickActionContext) return;

	const wasEnabled = quickActionContext.ignoreActionEnabled;
	setQuickActionBusy(true, wasEnabled ? "Removing ignore rule…" : "Adding ignore rule…");
	renderQuickActions(quickActionContext);

	try {
		await updateSyncList("ignoredHostnames", (currentValues) => {
			const nextValues = normalizeLowerList(currentValues);
			if (quickActionContext.ignoreActionEnabled) {
				nextValues.delete(quickActionContext.hostname);
			} else {
				nextValues.add(quickActionContext.hostname);
			}
			return nextValues;
		});
		await requestForceReevaluate();

		await renderActiveTabStatus();
		announcePopupFeedback(
			wasEnabled
				? "Ignore rule removed. Open tabs have been reorganized."
				: "Hostname ignored. Open tabs have been reorganized.",
		);
	} finally {
		setQuickActionBusy(false);
		renderQuickActions(quickActionContext);
	}
}

async function updateSelectedBundleMembership({ shouldAdd }) {
	if (!quickActionContext) return;

	const selectedIndex = Number(bundleSelectEl.value);
	if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return;

	const selectedBundleTitle = normalizeBundleTitle(
		quickActionContext.customDomainGroups[selectedIndex],
		selectedIndex,
	);
	setQuickActionBusy(
		true,
		shouldAdd
			? `Adding to ${selectedBundleTitle}…`
			: `Removing from ${selectedBundleTitle}…`,
	);
	renderQuickActions(quickActionContext);

	try {
		const stored = await chrome.storage.sync.get(DEFAULTS);
		const customDomainGroups = Array.isArray(stored.customDomainGroups)
			? stored.customDomainGroups
			: [];
		const selectedGroup = customDomainGroups[selectedIndex];
		if (!selectedGroup) return;

		const latestOwners = getCustomDomainBundleEntryOwners(
			customDomainGroups,
			quickActionContext.hostname,
		);
		const latestSelectedOwners = latestOwners.filter(
			(owner) => owner.groupIndex === selectedIndex,
		);

		if (shouldAdd && latestOwners.length > 0) return;
		if (!shouldAdd && latestSelectedOwners.length === 0) return;

		const currentDomains = Array.isArray(selectedGroup.domains)
			? selectedGroup.domains
			: [];
		const normalizedDomains = normalizeLowerArray(currentDomains);
		const nextDomains = shouldAdd
			? [...normalizedDomains, quickActionContext.hostname]
			: normalizedDomains.filter(
					(domain) => domain !== quickActionContext.hostname,
				);

		customDomainGroups[selectedIndex] = {
			...selectedGroup,
			domains: nextDomains,
		};
		await chrome.storage.sync.set({ customDomainGroups });
		await requestForceReevaluate();

		await renderActiveTabStatus();
		announcePopupFeedback(
			shouldAdd
				? `Added to ${selectedBundleTitle}. Open tabs have been reorganized.`
				: `Removed from ${selectedBundleTitle}.`,
		);
	} finally {
		setQuickActionBusy(false);
		renderQuickActions(quickActionContext);
	}
}

async function addHostnameToSelectedBundle() {
	return updateSelectedBundleMembership({ shouldAdd: true });
}

async function removeHostnameFromSelectedBundle() {
	return updateSelectedBundleMembership({ shouldAdd: false });
}

async function toggleDomainAction() {
	if (!quickActionContext?.domainActionAvailable) return;

	const wasEnabled = quickActionContext.domainActionEnabled;
	setQuickActionBusy(true, wasEnabled ? "Removing rule…" : "Adding rule…");
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
		await requestForceReevaluate();

		await renderActiveTabStatus();
		announcePopupFeedback(
			wasEnabled
				? "Rule removed. Open tabs have been reorganized."
				: "Rule added. Open tabs have been reorganized.",
		);
	} finally {
		setQuickActionBusy(false);
		renderQuickActions(quickActionContext);
	}
}

async function closeAllUnpinnedTabsInCurrentWindow() {
	const [activeTab] = await chrome.tabs.query({
		active: true,
		currentWindow: true,
	});
	const windowId = activeTab?.windowId;
	if (windowId == null) return;

	const tabsInWindow = await chrome.tabs.query({ windowId });
	const pinnedTabs = tabsInWindow.filter((tab) => tab?.pinned === true);
	const unpinnedTabs = tabsInWindow.filter(
		(tab) => tab?.id != null && tab.pinned !== true,
	);

	if (unpinnedTabs.length === 0) return;

	let replacementTabId = null;
	if (pinnedTabs.length === 0) {
		const replacementTab = await chrome.tabs.create({
			windowId,
			active: true,
		});
		replacementTabId = replacementTab?.id ?? null;
	}

	const tabIdsToClose = unpinnedTabs
		.map((tab) => tab.id)
		.filter((tabId) => tabId != null && tabId !== replacementTabId);

	if (tabIdsToClose.length === 0) return;

	await chrome.tabs.remove(tabIdsToClose);
}

async function renderActiveTabStatus() {
	const [activeTab] = await chrome.tabs.query({
		active: true,
		currentWindow: true,
	});

	if (!activeTab?.url) {
		setStatus({
			hostname: "Unavailable",
			target: "Unavailable",
			explanation: "This tab’s URL is not available right now.",
		});
		renderQuickActions(null);
		return;
	}

	const parsedUrl = safeParseUrl(activeTab.url);
	if (!isWebUrl(parsedUrl)) {
		setStatus({
			hostname: "Unsupported page",
			target: "Not grouped",
			explanation:
				"This page is not grouped because only web pages can be grouped.",
		});
		renderQuickActions(null);
		return;
	}

	const settings = await chrome.storage.sync.get(DEFAULTS);
	const commonMultipartSuffixes = normalizeLowerList(
		settings.commonMultipartSuffixes,
	);
	const excludedFromRootCollapse = normalizeLowerList(
		settings.excludedFromRootCollapse,
	);
	const ignoredHostnames = normalizeLowerList(settings.ignoredHostnames);
	const hostname = parsedUrl.hostname.toLowerCase();
	const isIgnored = ignoredHostnames.has(hostname);
	// Mirror the background worker's shared precedence so the popup explanation matches runtime grouping behavior.
	const grouping = resolveGroupingForHostname({
		url: parsedUrl.href,
		hostname: parsedUrl.hostname,
		pathname: parsedUrl.pathname,
		commonMultipartSuffixes,
		excludedFromRootCollapse,
		ignoredHostnames,
		customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
		managedPrefix: settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix,
	});
	const groupingWithoutIgnore = grouping ?? resolveGroupingForHostname({
		url: parsedUrl.href,
		hostname,
		pathname: parsedUrl.pathname,
		commonMultipartSuffixes,
		excludedFromRootCollapse,
		customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
		managedPrefix: settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix,
	});
	const domainAction = getDomainWideSeparationRule(
		hostname,
		commonMultipartSuffixes,
	);
	const domainActionAvailable = !!domainAction;

	setStatus({
		hostname,
		target: isIgnored ? "Ignored" : tabTargetLabel(activeTab, groupingWithoutIgnore),
		explanation: isIgnored
			? `This tab is unmanaged because ${hostname} is on the ignored-hostnames list.`
			: getExplanation(activeTab, groupingWithoutIgnore),
	});

	const customDomainGroups = Array.isArray(settings.customDomainGroups)
		? settings.customDomainGroups
		: [];
	const bundleOwners = getCustomDomainBundleEntryOwners(
		customDomainGroups,
		hostname,
	);
	const bundleMembershipByIndex = new Set(
		bundleOwners.map((owner) => owner.groupIndex),
	);

	renderQuickActions({
		hostname,
		ignoreActionEnabled: isIgnored,
		exactActionEnabled: excludedFromRootCollapse.has(hostname),
		domainActionAvailable,
		domainActionEnabled:
			domainActionAvailable &&
			commonMultipartSuffixes.has(domainAction.token),
		domainActionAffectsCurrentTab: domainAction?.affectsHostname ?? false,
		domainActionLabel: domainAction?.label ?? "",
		domainActionToken: domainAction?.token ?? "",
		customDomainGroups,
		bundleMembershipByIndex,
		bundleOwners,
	});
}

document.getElementById("openSettings").addEventListener("click", async () => {
	await chrome.runtime.openOptionsPage();
	window.close();
});

toggleExactActionButton.addEventListener("click", () => {
	toggleExactAction().catch((error) => {
		console.error("Failed to update exact-host separation rule", error);
		announcePopupFeedback("Could not update settings. Try again.");
	});
});

toggleIgnoreActionButton.addEventListener("click", () => {
	toggleIgnoreAction().catch((error) => {
		console.error("Failed to update ignored-hostname rule", error);
		announcePopupFeedback("Could not update settings. Try again.");
	});
});

toggleDomainActionButton.addEventListener("click", () => {
	toggleDomainAction().catch((error) => {
		console.error("Failed to update domain-wide separation rule", error);
		announcePopupFeedback("Could not update settings. Try again.");
	});
});

bundleSelectEl.addEventListener("change", updateBundleSelectionStatus);

applyBundleActionButton.addEventListener("click", () => {
	addHostnameToSelectedBundle().catch((error) => {
		console.error("Failed to add hostname to custom domain bundle", error);
		announcePopupFeedback("Could not update settings. Try again.");
	});
});

removeBundleActionButton.addEventListener("click", () => {
	removeHostnameFromSelectedBundle().catch((error) => {
		console.error(
			"Failed to remove hostname from custom domain bundle",
			error,
		);
		announcePopupFeedback("Could not update settings. Try again.");
	});
});

forceReevaluateButton?.addEventListener("click", async () => {
	if (!forceReevaluateButton) return;

	const originalLabel = forceReevaluateButton.textContent;
	forceReevaluateButton.disabled = true;
	forceReevaluateButton.textContent = "Reevaluating…";
	setReapplyBusy(true, "Reapplying rules…");

	try {
		await requestForceReevaluate();
		window.close();
	} catch (error) {
		console.error("Failed to force reevaluation", error);
		forceReevaluateButton.disabled = false;
		forceReevaluateButton.textContent =
			originalLabel ?? "Reevaluate open tabs now";
		setReapplyBusy(false);
		announcePopupFeedback("Could not reapply rules. Try again.");
	}
});

closeAllInWindowButton?.addEventListener("click", () => {
	const confirmed = window.confirm(
		"Close all unpinned tabs and clear all tab groups in this window only?\n\nPinned tabs will not be touched.",
	);

	if (!confirmed) return;

	closeAllUnpinnedTabsInCurrentWindow()
		.then(() => {
			window.close();
		})
		.catch((error) => {
			console.error(
				"Failed to close unpinned tabs in current window",
				error,
			);
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
	announcePopupFeedback("Could not load popup status. Try again.");
});
