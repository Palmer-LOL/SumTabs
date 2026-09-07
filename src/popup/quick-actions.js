import { DEFAULTS } from "../core/defaults.js";

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

	function render(context) {
		quickActionContext = context;

		if (!context) {
			elements.card.hidden = true;
			elements.ignoreRow.hidden = true;
			elements.exactRow.hidden = true;
			elements.domainRow.hidden = true;
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
	}

	return { bind, render };
}
