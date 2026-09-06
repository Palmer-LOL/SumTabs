import { DEFAULTS } from "../core/defaults.js";
import { getActiveTabStatus } from "./active-tab-status.js";
import { createQuickActions } from "./quick-actions.js";
import { initWindowActions } from "./window-actions.js";
import { initWindowSummary } from "./window-summary.js";

function cacheElements(documentRef) {
	return {
		activeHostname: documentRef.getElementById("activeHostname"),
		groupingTarget: documentRef.getElementById("groupingTarget"),
		groupingExplanation: documentRef.getElementById("groupingExplanation"),
		feedback: documentRef.getElementById("popupFeedback"),
		headerActions: documentRef.querySelector(".popup__header-actions"),
		openSettings: documentRef.getElementById("openSettings"),
		forceReevaluate: documentRef.getElementById("forceReevaluate"),
		quickActions: {
			card: documentRef.getElementById("quickActionsCard"),
			ignoreRow: documentRef.getElementById("ignoreActionRow"),
			ignoreLabel: documentRef.getElementById("ignoreActionLabel"),
			ignoreStatus: documentRef.getElementById("ignoreActionStatus"),
			toggleIgnore: documentRef.getElementById("toggleIgnoreAction"),
			exactRow: documentRef.getElementById("exactActionRow"),
			exactLabel: documentRef.getElementById("exactActionLabel"),
			exactStatus: documentRef.getElementById("exactActionStatus"),
			toggleExact: documentRef.getElementById("toggleExactAction"),
			domainRow: documentRef.getElementById("domainActionRow"),
			domainLabel: documentRef.getElementById("domainActionLabel"),
			domainStatus: documentRef.getElementById("domainActionStatus"),
			toggleDomain: documentRef.getElementById("toggleDomainAction"),
			bundleRow: documentRef.getElementById("bundleActionRow"),
			bundleSelect: documentRef.getElementById("bundleSelect"),
			bundleStatus: documentRef.getElementById("bundleActionStatus"),
			applyBundle: documentRef.getElementById("applyBundleAction"),
			removeBundle: documentRef.getElementById("removeBundleAction"),
		},
	};
}

function announcePopupFeedback(elements, message) {
	if (!elements.feedback) return;
	elements.feedback.textContent = message;
}

function setStatus(elements, { hostname, target, explanation }) {
	elements.activeHostname.textContent = hostname;
	elements.groupingTarget.textContent = target;
	elements.groupingExplanation.textContent = explanation;
}

function setReapplyBusy(elements, isBusy, message = "") {
	elements.headerActions?.setAttribute("aria-busy", String(isBusy));
	if (message) announcePopupFeedback(elements, message);
}

async function requestForceReevaluate(chromeApi) {
	const response = await chromeApi.runtime.sendMessage({
		type: "sumtabs:force-reevaluate",
	});
	if (response?.ok) return response;
	throw new Error(response?.error || "Could not reapply rules.");
}

function bindPopupControls({ chromeApi, elements, windowRef }) {
	elements.openSettings.addEventListener("click", async () => {
		await chromeApi.runtime.openOptionsPage();
		windowRef.close();
	});

	elements.forceReevaluate?.addEventListener("click", async () => {
		if (!elements.forceReevaluate) return;

		const originalLabel = elements.forceReevaluate.textContent;
		elements.forceReevaluate.disabled = true;
		elements.forceReevaluate.textContent = "Reevaluating…";
		setReapplyBusy(elements, true, "Reapplying rules…");

		try {
			await requestForceReevaluate(chromeApi);
			windowRef.close();
		} catch (error) {
			console.error("Failed to force reevaluation", error);
			elements.forceReevaluate.disabled = false;
			elements.forceReevaluate.textContent =
				originalLabel ?? "Reevaluate open tabs now";
			setReapplyBusy(elements, false);
			announcePopupFeedback(elements, "Could not reapply rules. Try again.");
		}
	});
}

function bindExclusiveDisclosures(documentRef) {
	const boundSections = new WeakSet();
	const bindSections = () => {
		const popupSections = [
			...documentRef.querySelectorAll(".popup__section"),
		];

		for (const section of popupSections) {
			if (boundSections.has(section)) continue;
			boundSections.add(section);
			section.addEventListener("toggle", () => {
				if (!section.open) return;

				for (const otherSection of documentRef.querySelectorAll(
					".popup__section",
				)) {
					if (otherSection !== section) otherSection.open = false;
				}
			});
		}
	};

	bindSections();
	return bindSections;
}

function bindRuleToggle({ documentRef, toggleId, proxyButtonId }) {
	const toggle = documentRef.getElementById(toggleId);
	const proxyButton = documentRef.getElementById(proxyButtonId);
	const row = proxyButton?.closest(".popup__status-row");
	if (!toggle || !proxyButton || !row) return;

	let updatePending = false;

	const proxyRepresentsEnabledRule = () =>
		proxyButton.textContent.trim() === "Remove rule";

	const syncToggle = () => {
		const proxyDisabled = proxyButton.disabled;

		if (!updatePending || !proxyDisabled) {
			toggle.checked = proxyRepresentsEnabledRule();
		}

		toggle.disabled = proxyDisabled || row.hidden;

		if (updatePending && !proxyDisabled) {
			updatePending = false;
		}
	};

	toggle.addEventListener("change", () => {
		if (toggle.checked === proxyRepresentsEnabledRule()) return;

		updatePending = true;
		toggle.disabled = true;
		proxyButton.click();
	});

	const MutationObserverRef =
		documentRef.defaultView?.MutationObserver ?? MutationObserver;
	const observer = new MutationObserverRef(syncToggle);
	observer.observe(proxyButton, {
		attributes: true,
		attributeFilter: ["disabled"],
		childList: true,
		subtree: true,
	});
	observer.observe(row, {
		attributes: true,
		attributeFilter: ["hidden"],
	});

	syncToggle();
}

function bindPopupUi(documentRef) {
	const refreshDisclosureBindings = bindExclusiveDisclosures(documentRef);
	bindRuleToggle({
		documentRef,
		toggleId: "ignoreActionToggle",
		proxyButtonId: "toggleIgnoreAction",
	});
	bindRuleToggle({
		documentRef,
		toggleId: "exactActionToggle",
		proxyButtonId: "toggleExactAction",
	});
	bindRuleToggle({
		documentRef,
		toggleId: "domainActionToggle",
		proxyButtonId: "toggleDomainAction",
	});
	return refreshDisclosureBindings;
}

async function initPopup({
	chromeApi = chrome,
	documentRef = document,
	windowRef = window,
} = {}) {
	const elements = cacheElements(documentRef);
	let quickActions;
	const refresh = async () => {
		const { status, context } = await getActiveTabStatus({
			chromeApi,
			defaults: DEFAULTS,
		});
		setStatus(elements, status);
		quickActions.render(context);
	};
	quickActions = createQuickActions({
		chromeApi,
		elements: elements.quickActions,
		announce: (message) => announcePopupFeedback(elements, message),
		refresh,
	});

	quickActions.bind();
	bindPopupControls({ chromeApi, elements, windowRef });
	const refreshDisclosureBindings = bindPopupUi(documentRef);

	await initWindowActions({ chromeApi, documentRef });
	await initWindowSummary({ chromeApi, documentRef });
	refreshDisclosureBindings();
	await refresh();
}

initPopup().catch((error) => {
	console.error("Failed to render popup status", error);
	const elements = cacheElements(document);
	setStatus(elements, {
		hostname: "Unavailable",
		target: "Unavailable",
		explanation: "Could not determine this tab’s grouping status.",
	});
	elements.quickActions.card.hidden = true;
	elements.quickActions.ignoreRow.hidden = true;
	elements.quickActions.exactRow.hidden = true;
	elements.quickActions.domainRow.hidden = true;
	elements.quickActions.bundleRow.hidden = true;
	announcePopupFeedback(elements, "Could not load popup status. Try again.");
});
