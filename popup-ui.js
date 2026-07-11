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

    const proxyRepresentsEnabledRule = () => proxyButton.textContent.trim() === "Remove rule";

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

bindRuleToggle({
    toggleId: "exactActionToggle",
    proxyButtonId: "toggleExactAction",
});

bindRuleToggle({
    toggleId: "domainActionToggle",
    proxyButtonId: "toggleDomainAction",
});
