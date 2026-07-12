import "./window-actions.js";
import { DEFAULTS } from "./defaults.js";

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

function installCurrentWindowSection() {
	const existingSection = document.getElementById("windowSummarySection");
	if (existingSection) {
		return {
			section: existingSection,
			content: document.getElementById("windowSummaryContent"),
			actionsContent: document.getElementById("windowActionsContent"),
		};
	}

	const statusSection = document.getElementById("statusCard");
	const actionsContent = document.getElementById("windowActionsContent");
	const summary = actionsContent?.querySelector(".popup__window-summary");
	if (!statusSection || !actionsContent || !summary) return null;

	const summaryNote = summary.nextElementSibling;
	const embeddedHeading = actionsContent.querySelector(
		":scope > .popup__window-actions-heading",
	);

	const section = document.createElement("details");
	section.className = "popup__section";
	section.id = "windowSummarySection";
	section.innerHTML = `
		<summary class="popup__section-summary">Current window</summary>
		<div
			class="popup__section-content popup__window-summary-content"
			id="windowSummaryContent"
			aria-busy="false"
		></div>
	`;

	statusSection.insertAdjacentElement("afterend", section);
	const content = section.querySelector("#windowSummaryContent");
	content.appendChild(summary);
	if (summaryNote?.classList.contains("settings__small-text")) {
		content.appendChild(summaryNote);
	}
	embeddedHeading?.remove();

	return { section, content, actionsContent };
}

function pluralize(count, singular, plural = `${singular}s`) {
	return count === 1 ? singular : plural;
}

function describeTabs(tabCount, groupCount = null) {
	const tabs = `${tabCount} ${pluralize(tabCount, "tab")}`;
	if (groupCount == null) return tabs;
	return `${tabs} · ${groupCount} ${pluralize(groupCount, "group")}`;
}

async function inspectCurrentWindow() {
	const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(
		(tab) => tab?.id != null,
	);
	const groupIds = new Set(
		tabs
			.map((tab) => tab.groupId)
			.filter((groupId) => groupId != null && groupId !== NONE),
	);
	const managedGroupIds = new Set();

	await Promise.all(
		[...groupIds].map(async (groupId) => {
			try {
				const group = await chrome.tabGroups.get(groupId);
				if (group?.title?.startsWith(DEFAULTS.autoGroupPrefix)) {
					managedGroupIds.add(groupId);
				}
			} catch {
				// Conservatively treat unreadable or disappearing groups as unmanaged.
			}
		}),
	);

	const pinnedTabs = tabs.filter((tab) => tab.pinned === true);
	const unpinnedTabs = tabs.filter((tab) => tab.pinned !== true);
	const ungroupedTabs = unpinnedTabs.filter(
		(tab) => tab.groupId == null || tab.groupId === NONE,
	);
	const managedTabs = unpinnedTabs.filter((tab) =>
		managedGroupIds.has(tab.groupId),
	);
	const unmanagedTabs = unpinnedTabs.filter(
		(tab) =>
			tab.groupId != null &&
			tab.groupId !== NONE &&
			!managedGroupIds.has(tab.groupId),
	);

	return {
		pinnedTabs,
		ungroupedTabs,
		managedTabs,
		unmanagedTabs,
		managedGroupIds,
		unmanagedGroupIds: new Set(unmanagedTabs.map((tab) => tab.groupId)),
	};
}

function setCount(id, value) {
	const element = document.getElementById(id);
	if (element) element.textContent = value;
}

function renderSummary(context) {
	setCount("ungroupedTabCount", describeTabs(context.ungroupedTabs.length));
	setCount(
		"managedTabCount",
		describeTabs(context.managedTabs.length, context.managedGroupIds.size),
	);
	setCount(
		"unmanagedTabCount",
		describeTabs(context.unmanagedTabs.length, context.unmanagedGroupIds.size),
	);
	setCount("pinnedTabCount", describeTabs(context.pinnedTabs.length));
}

function setSummaryLoading(content) {
	content.setAttribute("aria-busy", "true");
	for (const id of [
		"ungroupedTabCount",
		"managedTabCount",
		"unmanagedTabCount",
		"pinnedTabCount",
	]) {
		setCount(id, "Checking…");
	}
}

async function refreshSummary(content) {
	setSummaryLoading(content);
	try {
		renderSummary(await inspectCurrentWindow());
	} catch (error) {
		console.error("Failed to refresh current-window summary", error);
		const feedback = document.getElementById("popupFeedback");
		if (feedback) feedback.textContent = "Could not inspect this window. Try again.";
	} finally {
		content.setAttribute("aria-busy", "false");
	}
}

function mirrorActionBusyState(summaryContent, actionsContent) {
	const sync = () => {
		summaryContent.setAttribute(
			"aria-busy",
			actionsContent.getAttribute("aria-busy") ?? "false",
		);
	};
	const observer = new MutationObserver(sync);
	observer.observe(actionsContent, {
		attributes: true,
		attributeFilter: ["aria-busy"],
	});
	sync();
}

const ui = installCurrentWindowSection();
if (ui?.content && ui.actionsContent) {
	mirrorActionBusyState(ui.content, ui.actionsContent);
	ui.section.addEventListener("toggle", () => {
		if (ui.section.open) void refreshSummary(ui.content);
	});
	void refreshSummary(ui.content);
}
