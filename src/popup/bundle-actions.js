import {
	buildBundleRuleEntry,
	getBundleRuleOptions,
	previewBundleRule,
} from "../core/bundle-rule-options.js";

function bundleTitle(bundle, index) {
	return String(bundle?.title ?? "").trim() || `Untitled bundle ${index + 1}`;
}

function fillSelect(select, options, preferredValue, { selectFirst = false } = {}) {
	select.replaceChildren();
	for (const item of options) {
		const option = select.ownerDocument.createElement("option");
		option.value = String(item.value);
		option.textContent = item.label;
		select.appendChild(option);
	}
	if (options.some((item) => String(item.value) === String(preferredValue))) {
		select.value = String(preferredValue);
	} else if (selectFirst && options.length > 0) {
		select.value = String(options[0].value);
	}
}

function resultMessage(response, operation, title) {
	switch (response?.status) {
		case "added": return `Rule added to ${title}. Open tabs have been reorganized.`;
		case "removed": return `Rule removed from ${title}. Open tabs have been reorganized.`;
		case "already-present": return `That rule is already in ${title}.`;
		case "not-present": return `That rule is no longer in ${title}.`;
		case "duplicate-rule": return "That exact rule belongs to another bundle.";
		case "stale-bundles": return "Bundles changed in Settings. The latest version is shown.";
		case "saved-reevaluation-failed": return `Rule ${operation === "add" ? "added" : "removed"}, but open tabs could not be reorganized.`;
		case "invalid-rule": return "That rule is not valid.";
		default: return response?.error || "Could not update the bundle rule. Try again.";
	}
}

const BUNDLE_COLORS = {
	grey: "#5f6368", blue: "#1a73e8", red: "#d93025", yellow: "#f9ab00",
	green: "#188038", pink: "#d01884", purple: "#9334e6", cyan: "#007b83",
	orange: "#e8710a",
};

export function createBundleActions({ chromeApi, elements, announce, refresh }) {
	let context = null;
	let busy = false;
	let selectedBundle = "0";
	let selectedHost = "";
	let selectedPath = "";
	let selectedRule = "";
	let requireBundleSelection = false;

	function readSelections() {
		selectedBundle = elements.bundleSelect.value || selectedBundle;
		selectedHost = elements.hostScope.value || selectedHost;
		selectedPath = elements.pathScope.value;
		selectedRule = elements.ruleSelect.value;
	}

	function render(nextContext) {
		readSelections();
		context = nextContext;
		const bundles = Array.isArray(context?.settings?.customDomainGroups)
			? context.settings.customDomainGroups
			: [];
		elements.card.hidden = false;
		elements.card.setAttribute("aria-busy", String(busy));

		const bundleOptions = bundles.map((bundle, index) => ({
			value: index, label: bundleTitle(bundle, index),
		}));
		if (requireBundleSelection) {
			bundleOptions.unshift({ value: "", label: "Choose a bundle" });
		}
		fillSelect(elements.bundleSelect, bundleOptions, requireBundleSelection ? "" : selectedBundle, { selectFirst: true });
		selectedBundle = elements.bundleSelect.value;
		const bundleIndex = selectedBundle === "" ? -1 : Number(selectedBundle);
		const selected = bundles[bundleIndex];
		elements.bundleSelect.disabled = busy || bundles.length === 0;
		elements.bundleColor.textContent = selected
			? `Color: ${String(selected.color || "grey")}`
			: bundles.length ? "Choose a bundle to view its rules." : "No custom bundles yet.";
		elements.bundleColor.style.setProperty?.(
			"--bundle-color",
			BUNDLE_COLORS[selected?.color] ?? BUNDLE_COLORS.grey,
		);

		const rules = Array.isArray(selected?.domains) ? selected.domains : [];
		fillSelect(elements.ruleSelect, rules.map((rule) => ({ value: rule, label: rule })), selectedRule);
		selectedRule = elements.ruleSelect.value;
		elements.ruleSelect.disabled = busy || rules.length === 0;
		elements.remove.disabled = busy || !selected || !selectedRule;

		const options = getBundleRuleOptions({
			url: context?.url,
			commonMultipartSuffixes: context?.settings?.commonMultipartSuffixes,
		});
		fillSelect(elements.hostScope, options.hostOptions ?? [], selectedHost || options.hostname);
		fillSelect(elements.pathScope, options.pathOptions ?? [], selectedPath);
		selectedHost = elements.hostScope.value;
		selectedPath = elements.pathScope.value;
		elements.hostScope.disabled = busy || !options.supported || !selected;
		elements.pathScope.disabled = busy || !options.supported || !selected;

		const built = buildBundleRuleEntry({ hostname: selectedHost, pathPrefix: selectedPath });
		elements.preview.textContent = options.supported && built.valid
			? `Rule: ${built.canonicalEntry}`
			: "Open an HTTP or HTTPS page to add a rule. You can still browse and remove stored rules.";
		elements.apply.disabled = busy || !selected || !options.supported || !built.valid;

		let message = rules.length ? `${rules.length} stored rule${rules.length === 1 ? "" : "s"}.` : "This bundle has no stored rules.";
		if (options.supported && built.valid && selected) {
			const preview = previewBundleRule({
				url: context.url,
				settings: context.settings,
				bundleIndex,
				entry: built.canonicalEntry,
			});
			const owners = preview.ownership ?? [];
			if (owners.some((owner) => owner.groupIndex !== bundleIndex)) {
				message = `That exact rule is already owned by ${owners.map((owner) => owner.title || `bundle ${owner.groupIndex + 1}`).join(", ")}.`;
				elements.apply.disabled = true;
			} else if (owners.some((owner) => owner.groupIndex === bundleIndex)) {
				message = "That exact rule is already stored in this bundle.";
				elements.apply.disabled = true;
			} else if (preview.afterGrouping?.identity) {
				const winningBundle = preview.afterGrouping.identity;
				const selectedIdentity = `${context.settings.autoGroupPrefix ?? "∑ "}${bundleTitle(selected, bundleIndex)}`;
				message = winningBundle === selectedIdentity
					? `After saving, this URL will resolve to ${winningBundle}.`
					: `The rule can be saved, but this URL will still resolve to ${winningBundle}.`;
			}
		}
		const hostname = options.hostname;
		const ignored = (context?.settings?.ignoredHostnames ?? []).map(String).map((v) => v.toLowerCase()).includes(hostname);
		if (context?.activeTab?.pinned) message += " This pinned tab stays untouched.";
		else if (ignored) message += " This ignored tab stays unmanaged until its ignore rule is removed.";
		else if (context?.activeTab?.userGroup) message += " SumTabs will not take over this user-created group.";
		if (selectedRule) {
			message += selectedRule.includes("/")
				? " Removing this path-prefix rule can affect other matching URLs and descendants."
				: " Removing this host-wide rule can affect other matching URLs.";
		}
		elements.status.textContent = message;
	}

	async function mutate(operation) {
		if (busy || !context) return;
		if (operation === "add" ? elements.apply.disabled : elements.remove.disabled) return;
		readSelections();
		const bundleIndex = selectedBundle === "" ? -1 : Number(selectedBundle);
		const bundles = Array.isArray(context.settings?.customDomainGroups) ? context.settings.customDomainGroups : [];
		const built = operation === "add"
			? buildBundleRuleEntry({ hostname: selectedHost, pathPrefix: selectedPath })
			: { valid: Boolean(selectedRule), canonicalEntry: selectedRule };
		if (!Number.isInteger(bundleIndex) || !bundles[bundleIndex] || !built.valid) return;
		busy = true;
		render(context);
		let response;
		try {
			response = await chromeApi.runtime.sendMessage({
				type: "sumtabs:update-bundle-rule",
				operation,
				bundleIndex,
				expectedBundlesSnapshot: JSON.stringify(bundles),
				entry: built.canonicalEntry,
			});
		} catch (error) {
			console.error("Failed to update custom bundle rule", error);
			announce("Could not update the bundle rule. Try again.");
			busy = false;
			render(context);
			return;
		}

		announce(resultMessage(response, operation, bundleTitle(bundles[bundleIndex], bundleIndex)));
		if (response?.status === "stale-bundles") requireBundleSelection = true;
		try {
			await refresh();
		} catch (error) {
			console.error("Bundle rule updated but popup refresh failed", error);
			announce(`${resultMessage(response, operation, bundleTitle(bundles[bundleIndex], bundleIndex))} The popup view could not refresh.`);
		} finally {
			busy = false;
			render(context);
		}
	}

	function bind() {
		elements.bundleSelect.addEventListener("change", () => {
			requireBundleSelection = false;
			selectedRule = "";
			elements.ruleSelect.value = "";
			render(context);
		});
		for (const select of [elements.hostScope, elements.pathScope, elements.ruleSelect]) {
			select.addEventListener("change", () => render(context));
		}
		elements.apply.addEventListener("click", () => mutate("add"));
		elements.remove.addEventListener("click", () => mutate("remove"));
		elements.openSettings.addEventListener("click", () => chromeApi.runtime.openOptionsPage());
	}

	return { bind, render };
}
