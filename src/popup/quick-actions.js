import { DEFAULTS } from "../core/defaults.js";
import { getCustomDomainBundleEntryOwners } from "../core/grouping.js";

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

export function createQuickActions({ chromeApi, elements, announce, refresh }) {
	let quickActionContext = null;
	let quickActionInFlight = false;

	function setQuickActionBusy(isBusy, message = "") {
		quickActionInFlight = isBusy;
		elements.card?.setAttribute("aria-busy", String(isBusy));
		if (message) announce(message);
	}

	async function requestForceReevaluate() {
		const response = await chromeApi.runtime.sendMessage({
			type: "sumtabs:force-reevaluate",
		});
		if (response?.ok) return response;
		throw new Error(response?.error || "Could not reapply rules.");
	}

	async function requestIgnoredHostnameUpdate(hostname, shouldIgnore) {
		const response = await chromeApi.runtime.sendMessage({
			type: "sumtabs:update-ignored-hostname",
			hostname,
			shouldIgnore,
		});
		if (response?.ok) return response;
		throw new Error(response?.error || "Could not update ignored hostname.");
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
		const selectedIndex = Number(elements.bundleSelect.value);
		const isAlreadyInSelectedBundle =
			quickActionContext.bundleMembershipByIndex.has(selectedIndex);
		const isInAnyBundle = quickActionContext.bundleOwners.length > 0;
		const isOnlyInSelectedBundle =
			isAlreadyInSelectedBundle &&
			quickActionContext.bundleOwners.every(
				(owner) => owner.groupIndex === selectedIndex,
			);

		elements.applyBundle.disabled =
			!hasBundles ||
			isAlreadyInSelectedBundle ||
			isInAnyBundle ||
			quickActionInFlight;
		elements.removeBundle.disabled =
			!hasBundles || !isAlreadyInSelectedBundle || quickActionInFlight;

		if (!hasBundles) {
			elements.bundleStatus.textContent =
				"No custom bundles exist yet. Open Settings to create one.";
		} else if (isOnlyInSelectedBundle) {
			elements.bundleStatus.textContent = `${quickActionContext.hostname} is already in this bundle. Use Remove to take it out.`;
		} else if (isInAnyBundle) {
			elements.bundleStatus.textContent = `${quickActionContext.hostname} is already in ${getBundleOwnershipLabel(quickActionContext.bundleOwners)}. Remove it there before adding it to another bundle.`;
		} else {
			elements.bundleStatus.textContent = `Add ${quickActionContext.hostname} to ${normalizeBundleTitle(quickActionContext.customDomainGroups[selectedIndex], selectedIndex)}.`;
		}
	}

	function renderBundleAction(context) {
		elements.bundleRow.hidden = false;
		elements.bundleSelect.innerHTML = "";

		const bundles = context.customDomainGroups;
		bundles.forEach((group, index) => {
			const option = elements.bundleSelect.ownerDocument.createElement("option");
			option.value = String(index);
			option.textContent = normalizeBundleTitle(group, index);
			elements.bundleSelect.appendChild(option);
		});

		const hasBundles = bundles.length > 0;
		elements.bundleSelect.disabled = !hasBundles || quickActionInFlight;
		updateBundleSelectionStatus();
	}

	function render(context) {
		quickActionContext = context;

		if (!context) {
			elements.card.hidden = true;
			elements.ignoreRow.hidden = true;
			elements.exactRow.hidden = true;
			elements.domainRow.hidden = true;
			elements.bundleRow.hidden = true;
			return;
		}

		elements.card.hidden = false;

		setActionState({
			row: elements.ignoreRow,
			label: elements.ignoreLabel,
			status: {
				element: elements.ignoreStatus,
				label: `Ignore ${context.hostname}`,
				message: context.ignoreActionEnabled
					? `${context.hostname} is ignored and will not be managed by SumTabs.`
					: `Keep ${context.hostname} completely unmanaged.`,
			},
			button: elements.toggleIgnore,
			buttonText: context.ignoreActionEnabled ? "Remove rule" : "Add rule",
		});

		setActionState({
			row: elements.exactRow,
			label: elements.exactLabel,
			status: {
				element: elements.exactStatus,
				label: `Separate only ${context.hostname}`,
				message: context.exactActionEnabled
					? `${context.hostname} is already listed in exact-host separation rules.`
					: `Add ${context.hostname} to exact-host separation rules.`,
			},
			button: elements.toggleExact,
			buttonText: context.exactActionEnabled ? "Remove rule" : "Add rule",
		});

		setActionState({
			row: elements.domainRow,
			label: elements.domainLabel,
			status: {
				element: elements.domainStatus,
				label: context.domainActionLabel,
				message: context.domainActionEnabled
					? context.domainActionAffectsCurrentTab
						? `${context.domainActionToken} is already separating this tab from sibling subdomains.`
						: `${context.domainActionToken} is already listed in domain-wide separation rules.`
					: `Add ${context.domainActionToken} so its subdomains stay separate.`,
			},
			button: elements.toggleDomain,
			buttonText: context.domainActionEnabled ? "Remove rule" : "Add rule",
			hidden: !context.domainActionAvailable,
		});

		renderBundleAction(context);
	}

	async function updateSyncList(key, updateList) {
		const stored = await chromeApi.storage.sync.get(DEFAULTS);
		const currentValues = Array.isArray(stored[key])
			? stored[key]
			: DEFAULTS[key];
		const nextValues = normalizeLowerArray(updateList(currentValues));
		await chromeApi.storage.sync.set({ [key]: nextValues });
	}

	async function toggleExactAction() {
		if (!quickActionContext) return;

		const wasEnabled = quickActionContext.exactActionEnabled;
		setQuickActionBusy(true, wasEnabled ? "Removing rule…" : "Adding rule…");
		render(quickActionContext);

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

			await refresh();
			announce(
				wasEnabled
					? "Rule removed. Open tabs have been reorganized."
					: "Rule added. Open tabs have been reorganized.",
			);
		} finally {
			setQuickActionBusy(false);
			render(quickActionContext);
		}
	}

	async function toggleIgnoreAction() {
		if (!quickActionContext) return;

		const wasEnabled = quickActionContext.ignoreActionEnabled;
		setQuickActionBusy(
			true,
			wasEnabled ? "Removing ignore rule…" : "Adding ignore rule…",
		);
		render(quickActionContext);

		try {
			await requestIgnoredHostnameUpdate(
				quickActionContext.hostname,
				!quickActionContext.ignoreActionEnabled,
			);

			await refresh();
			announce(
				wasEnabled
					? "Ignore rule removed. Open tabs have been reorganized."
					: "Hostname ignored. Open tabs have been reorganized.",
			);
		} finally {
			setQuickActionBusy(false);
			render(quickActionContext);
		}
	}

	async function updateSelectedBundleMembership({ shouldAdd }) {
		if (!quickActionContext) return;

		const selectedIndex = Number(elements.bundleSelect.value);
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
		render(quickActionContext);

		try {
			const stored = await chromeApi.storage.sync.get(DEFAULTS);
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
			await chromeApi.storage.sync.set({ customDomainGroups });
			await requestForceReevaluate();

			await refresh();
			announce(
				shouldAdd
					? `Added to ${selectedBundleTitle}. Open tabs have been reorganized.`
					: `Removed from ${selectedBundleTitle}.`,
			);
		} finally {
			setQuickActionBusy(false);
			render(quickActionContext);
		}
	}

	async function toggleDomainAction() {
		if (!quickActionContext?.domainActionAvailable) return;

		const wasEnabled = quickActionContext.domainActionEnabled;
		setQuickActionBusy(true, wasEnabled ? "Removing rule…" : "Adding rule…");
		render(quickActionContext);

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

			await refresh();
			announce(
				wasEnabled
					? "Rule removed. Open tabs have been reorganized."
					: "Rule added. Open tabs have been reorganized.",
			);
		} finally {
			setQuickActionBusy(false);
			render(quickActionContext);
		}
	}

	function runAction(operation, errorLabel) {
		operation().catch((error) => {
			console.error(errorLabel, error);
			announce("Could not update settings. Try again.");
		});
	}

	function bind() {
		elements.toggleExact.addEventListener("click", () => {
			runAction(
				toggleExactAction,
				"Failed to update exact-host separation rule",
			);
		});
		elements.toggleIgnore.addEventListener("click", () => {
			runAction(toggleIgnoreAction, "Failed to update ignored-hostname rule");
		});
		elements.toggleDomain.addEventListener("click", () => {
			runAction(
				toggleDomainAction,
				"Failed to update domain-wide separation rule",
			);
		});
		elements.bundleSelect.addEventListener(
			"change",
			updateBundleSelectionStatus,
		);
		elements.applyBundle.addEventListener("click", () => {
			runAction(
				() => updateSelectedBundleMembership({ shouldAdd: true }),
				"Failed to add hostname to custom domain bundle",
			);
		});
		elements.removeBundle.addEventListener("click", () => {
			runAction(
				() => updateSelectedBundleMembership({ shouldAdd: false }),
				"Failed to remove hostname from custom domain bundle",
			);
		});
	}

	return { bind, render };
}
