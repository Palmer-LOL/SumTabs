const popupSections = [...document.querySelectorAll(".popup__section")];

for (const section of popupSections) {
	section.addEventListener("toggle", () => {
		if (!section.open) return;

		for (const otherSection of popupSections) {
			if (otherSection !== section) otherSection.open = false;
		}
	});
}

function bindRuleToggle({ toggleId, proxyButtonId }) {
	const toggle = document.getElementById(toggleId);
	const proxyButton = document.getElementById(proxyButtonId);
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

	const observer = new MutationObserver(syncToggle);
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

function getCloseAllContextElement(button) {
	let context = document.getElementById("closeAllInWindowContext");
	if (context) return context;

	context = document.createElement("div");
	context.className = "settings__small-text";
	context.id = "closeAllInWindowContext";
	button.insertAdjacentElement("afterend", context);
	button.setAttribute("aria-describedby", context.id);
	return context;
}

async function renderCloseAllContext() {
	const button = document.getElementById("closeAllInWindow");
	if (!button) return;

	const context = getCloseAllContextElement(button);
	button.disabled = true;
	button.setAttribute("aria-busy", "true");
	button.textContent = "Checking tabs…";
	context.textContent = "Checking this window before closing tabs.";

	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });
		const unpinnedTabCount = tabs.filter(
			(tab) => tab?.id != null && tab.pinned !== true,
		).length;
		const tabLabel = unpinnedTabCount === 1 ? "tab" : "tabs";

		if (unpinnedTabCount === 0) {
			button.textContent = "No unpinned tabs to close";
			button.disabled = true;
			context.textContent =
				"All tabs in this window are pinned, so there are no tab groups to clear.";
			return;
		}

		button.textContent = `Close ${unpinnedTabCount} unpinned ${tabLabel}`;
		button.disabled = false;
		context.textContent =
			"This will also clear every tab group in this window. Pinned tabs will remain open.";
	} catch (error) {
		console.error("Failed to count unpinned tabs in current window", error);
		button.textContent = "Close all unpinned tabs in this window";
		button.disabled = false;
		context.textContent =
			"This will also clear every tab group in this window. Pinned tabs will remain open.";
	} finally {
		button.setAttribute("aria-busy", "false");
	}
}

bindRuleToggle({
	toggleId: "exactActionToggle",
	proxyButtonId: "toggleExactAction",
});

bindRuleToggle({
	toggleId: "domainActionToggle",
	proxyButtonId: "toggleDomainAction",
});

const closeAllSection = document
	.getElementById("closeAllInWindow")
	?.closest(".popup__section");

closeAllSection?.addEventListener("toggle", () => {
	if (closeAllSection.open) void renderCloseAllContext();
});

void renderCloseAllContext();
