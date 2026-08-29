import { DEFAULTS } from "../core/defaults.js";

export async function initWindowActions({
	chromeApi = chrome,
	documentRef = document,
} = {}) {
	const chrome = chromeApi;
	const windowRef = documentRef.defaultView ?? window;
	const NONE = chromeApi.tabGroups.TAB_GROUP_ID_NONE;
	const ACTION_BUTTON_IDS = [
		"ungroupManagedGroups",
		"closeManagedTabs",
		"closeUngroupedTabs",
		"closeAllUnpinnedTabs",
	];

	function installStylesheet() {
		if (documentRef.querySelector('link[data-sumtabs-window-actions="true"]')) return;
		const link = documentRef.createElement("link");
		link.rel = "stylesheet";
		link.href = chrome.runtime.getURL("src/popup/window-actions.css");
		link.dataset.sumtabsWindowActions = "true";
		documentRef.head.appendChild(link);
	}

	function installWindowActionsUi() {
		const legacyButton = documentRef.getElementById("closeAllInWindow");
		const section =
			legacyButton?.closest(".popup__section") ??
			documentRef.querySelector(".popup__section--more");
		const content = section?.querySelector(".popup__section-content");
		if (!section || !content) return null;

		section.id = "windowActionsSection";
		content.id = "windowActionsContent";
		content.classList.add("popup__window-actions");
		content.setAttribute("aria-busy", "false");
		content.innerHTML = `
			<div class="popup__window-actions-heading">Current window</div>
			<dl class="popup__window-summary" aria-label="Current window tab summary">
				<div class="popup__window-summary-item">
					<dt>Ungrouped</dt>
					<dd id="ungroupedTabCount">Checking…</dd>
				</div>
				<div class="popup__window-summary-item">
					<dt>SumTabs-managed</dt>
					<dd id="managedTabCount">Checking…</dd>
				</div>
				<div class="popup__window-summary-item">
					<dt>Other groups</dt>
					<dd id="unmanagedTabCount">Checking…</dd>
				</div>
				<div class="popup__window-summary-item">
					<dt>Pinned (protected)</dt>
					<dd id="pinnedTabCount">Checking…</dd>
				</div>
			</dl>
			<div class="settings__small-text">
				“Other groups” are groups not managed by SumTabs. Their tabs are only affected by the close-all action.
			</div>

			<div class="popup__window-action-group">
				<div class="popup__window-actions-heading">Managed groups</div>
				<button class="button button--full-width" id="ungroupManagedGroups" type="button" aria-describedby="ungroupManagedContext">
					Ungroup managed groups
				</button>
				<div class="settings__small-text" id="ungroupManagedContext"></div>
			</div>

			<div class="popup__window-action-group">
				<div class="popup__window-actions-heading">Close tabs</div>
				<button class="button button--full-width button--danger" id="closeManagedTabs" type="button">
					Close managed-group tabs
				</button>
				<button class="button button--full-width button--danger" id="closeUngroupedTabs" type="button">
					Close ungrouped tabs
				</button>
				<button class="button button--full-width button--danger" id="closeAllUnpinnedTabs" type="button" aria-describedby="closeAllUnpinnedContext">
					Close all unpinned tabs
				</button>
				<div class="settings__small-text" id="closeAllUnpinnedContext"></div>
			</div>
		`;

		return section;
	}

	function getUi() {
		const section = installWindowActionsUi();
		if (!section) return null;

		return {
			section,
			content: documentRef.getElementById("windowActionsContent"),
			feedback: documentRef.getElementById("popupFeedback"),
			ungroupedCount: documentRef.getElementById("ungroupedTabCount"),
			managedCount: documentRef.getElementById("managedTabCount"),
			unmanagedCount: documentRef.getElementById("unmanagedTabCount"),
			pinnedCount: documentRef.getElementById("pinnedTabCount"),
			ungroupManaged: documentRef.getElementById("ungroupManagedGroups"),
			closeManaged: documentRef.getElementById("closeManagedTabs"),
			closeUngrouped: documentRef.getElementById("closeUngroupedTabs"),
			closeAllUnpinned: documentRef.getElementById("closeAllUnpinnedTabs"),
			ungroupContext: documentRef.getElementById("ungroupManagedContext"),
			closeAllContext: documentRef.getElementById("closeAllUnpinnedContext"),
		};
	}

	function pluralize(count, singular, plural = `${singular}s`) {
		return count === 1 ? singular : plural;
	}

	function describeTabs(tabCount, groupCount = null) {
		const tabs = `${tabCount} ${pluralize(tabCount, "tab")}`;
		if (groupCount == null) return tabs;
		return `${tabs} · ${groupCount} ${pluralize(groupCount, "group")}`;
	}

	function announce(ui, message) {
		if (ui.feedback) ui.feedback.textContent = message;
	}

	async function inspectCurrentWindow() {
		const tabs = (await chromeApi.tabs.query({ currentWindow: true })).filter(
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
					const group = await chromeApi.tabGroups.get(groupId);
					if (group?.title?.startsWith(DEFAULTS.autoGroupPrefix)) {
						managedGroupIds.add(groupId);
					}
				} catch {
					// A disappearing or unreadable group is treated as unmanaged. This keeps
					// SumTabs-specific actions conservative around user-created groups.
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
			unpinnedTabs,
			ungroupedTabs,
			managedTabs,
			unmanagedTabs,
			managedGroupIds,
			unmanagedGroupIds: new Set(unmanagedTabs.map((tab) => tab.groupId)),
		};
	}

	function setActionButton(button, count, enabledLabel, emptyLabel) {
		if (!button) return;
		button.disabled = count === 0;
		button.textContent = count === 0 ? emptyLabel : enabledLabel;
	}

	function renderContext(ui, context) {
		const managedGroups = context.managedGroupIds.size;
		const unmanagedGroups = context.unmanagedGroupIds.size;

		ui.ungroupedCount.textContent = describeTabs(context.ungroupedTabs.length);
		ui.managedCount.textContent = describeTabs(
			context.managedTabs.length,
			managedGroups,
		);
		ui.unmanagedCount.textContent = describeTabs(
			context.unmanagedTabs.length,
			unmanagedGroups,
		);
		ui.pinnedCount.textContent = describeTabs(context.pinnedTabs.length);

		setActionButton(
			ui.ungroupManaged,
			managedGroups,
			`Ungroup ${managedGroups} managed ${pluralize(managedGroups, "group")}`,
			"No managed groups to ungroup",
		);
		setActionButton(
			ui.closeManaged,
			context.managedTabs.length,
			`Close ${context.managedTabs.length} managed-group ${pluralize(context.managedTabs.length, "tab")}`,
			"No managed-group tabs to close",
		);
		setActionButton(
			ui.closeUngrouped,
			context.ungroupedTabs.length,
			`Close ${context.ungroupedTabs.length} ungrouped ${pluralize(context.ungroupedTabs.length, "tab")}`,
			"No ungrouped tabs to close",
		);
		setActionButton(
			ui.closeAllUnpinned,
			context.unpinnedTabs.length,
			`Close all ${context.unpinnedTabs.length} unpinned ${pluralize(context.unpinnedTabs.length, "tab")}`,
			"No unpinned tabs to close",
		);

		ui.ungroupContext.textContent = managedGroups
			? `${describeTabs(context.managedTabs.length)} will stay open. SumTabs may group them again after navigation or when rules are reapplied.`
			: "There are no SumTabs-managed groups in this window.";
		ui.closeAllContext.textContent = context.unpinnedTabs.length
			? "Includes ungrouped tabs and tabs in both managed and other groups. Pinned tabs will remain open."
			: "All tabs in this window are pinned.";
	}

	function setLoading(ui) {
		ui.content.setAttribute("aria-busy", "true");
		for (const element of [
			ui.ungroupedCount,
			ui.managedCount,
			ui.unmanagedCount,
			ui.pinnedCount,
		]) {
			element.textContent = "Checking…";
		}
		for (const id of ACTION_BUTTON_IDS) {
			const button = documentRef.getElementById(id);
			if (button) button.disabled = true;
		}
	}

	async function refresh(ui) {
		setLoading(ui);
		try {
			renderContext(ui, await inspectCurrentWindow());
		} catch (error) {
			console.error("Failed to inspect tabs in current window", error);
			announce(ui, "Could not inspect this window. Try again.");
		} finally {
			ui.content.setAttribute("aria-busy", "false");
		}
	}

	async function runBusy(ui, button, busyLabel, operation) {
		ui.content.setAttribute("aria-busy", "true");
		for (const id of ACTION_BUTTON_IDS) {
			const actionButton = documentRef.getElementById(id);
			if (actionButton) actionButton.disabled = true;
		}
		button.textContent = busyLabel;
		try {
			await operation();
		} finally {
			ui.content.setAttribute("aria-busy", "false");
		}
	}

	async function closeTabsSafely(targetTabs) {
		const requestedIds = new Set(
			targetTabs.map((tab) => tab?.id).filter((tabId) => tabId != null),
		);
		if (requestedIds.size === 0) return;

		const currentTabs = await chromeApi.tabs.query({ currentWindow: true });
		const targetIds = currentTabs
			.filter((tab) => tab?.id != null && requestedIds.has(tab.id))
			.map((tab) => tab.id);
		if (targetIds.length === 0) return;

		const targetIdSet = new Set(targetIds);
		const remainingTabs = currentTabs.filter(
			(tab) => tab?.id != null && !targetIdSet.has(tab.id),
		);
		if (remainingTabs.length === 0) await chromeApi.tabs.create({ active: true });

		await chromeApi.tabs.remove(targetIds);
	}

	async function ungroupManaged(ui) {
		const context = await inspectCurrentWindow();
		const groupCount = context.managedGroupIds.size;
		const tabCount = context.managedTabs.length;
		if (!groupCount || !tabCount) return refresh(ui);

		const confirmed = windowRef.confirm(
			`Ungroup ${groupCount} SumTabs-managed ${pluralize(groupCount, "group")} containing ${tabCount} ${pluralize(tabCount, "tab")} in this window?\n\nThe tabs will stay open. SumTabs may group them again after navigation or when rules are reapplied.`,
		);
		if (!confirmed) return;

		await runBusy(ui, ui.ungroupManaged, "Ungrouping managed groups…", () =>
			chromeApi.tabs.ungroup(context.managedTabs.map((tab) => tab.id)),
		);
		announce(
			ui,
			`Ungrouped ${groupCount} managed ${pluralize(groupCount, "group")}.`,
		);
		await refresh(ui);
	}

	async function closeManaged(ui) {
		const context = await inspectCurrentWindow();
		const tabCount = context.managedTabs.length;
		const groupCount = context.managedGroupIds.size;
		if (!tabCount) return refresh(ui);

		const confirmed = windowRef.confirm(
			`Close ${tabCount} ${pluralize(tabCount, "tab")} in ${groupCount} SumTabs-managed ${pluralize(groupCount, "group")} in this window?\n\nUngrouped tabs, other groups, and pinned tabs will remain open.`,
		);
		if (!confirmed) return;

		await runBusy(ui, ui.closeManaged, "Closing managed-group tabs…", () =>
			closeTabsSafely(context.managedTabs),
		);
		windowRef.close();
	}

	async function closeUngrouped(ui) {
		const context = await inspectCurrentWindow();
		const tabCount = context.ungroupedTabs.length;
		if (!tabCount) return refresh(ui);

		const confirmed = windowRef.confirm(
			`Close ${tabCount} ungrouped ${pluralize(tabCount, "tab")} in this window?\n\nTabs in managed or other groups and pinned tabs will remain open.`,
		);
		if (!confirmed) return;

		await runBusy(ui, ui.closeUngrouped, "Closing ungrouped tabs…", () =>
			closeTabsSafely(context.ungroupedTabs),
		);
		windowRef.close();
	}

	async function closeAllUnpinned(ui) {
		const context = await inspectCurrentWindow();
		const tabCount = context.unpinnedTabs.length;
		const groupCount =
			context.managedGroupIds.size + context.unmanagedGroupIds.size;
		if (!tabCount) return refresh(ui);

		const groupWarning = groupCount
			? `This will also clear ${groupCount} tab ${pluralize(groupCount, "group")}. `
			: "";
		const confirmed = windowRef.confirm(
			`Close all ${tabCount} unpinned ${pluralize(tabCount, "tab")} in this window?\n\n${groupWarning}Pinned tabs will not be touched.`,
		);
		if (!confirmed) return;

		await runBusy(ui, ui.closeAllUnpinned, "Closing unpinned tabs…", () =>
			closeTabsSafely(context.unpinnedTabs),
		);
		windowRef.close();
	}

	function bindAction(ui, button, operation, errorLabel) {
		button.addEventListener("click", () => {
			operation(ui).catch((error) => {
				console.error(errorLabel, error);
				announce(ui, "Could not complete that window action. Try again.");
				void refresh(ui);
			});
		});
	}

	installStylesheet();
	const ui = getUi();
	if (ui) {
		ui.section.addEventListener("toggle", () => {
			if (ui.section.open) void refresh(ui);
		});
		bindAction(
			ui,
			ui.ungroupManaged,
			ungroupManaged,
			"Failed to ungroup managed groups",
		);
		bindAction(
			ui,
			ui.closeManaged,
			closeManaged,
			"Failed to close managed-group tabs",
		);
		bindAction(
			ui,
			ui.closeUngrouped,
			closeUngrouped,
			"Failed to close ungrouped tabs",
		);
		bindAction(
			ui,
			ui.closeAllUnpinned,
			closeAllUnpinned,
			"Failed to close unpinned tabs",
		);
		await refresh(ui);
	}
}
