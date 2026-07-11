(() => {
  const STORAGE_KEY = "sumtabs.themePreference";
  const VALID_PREFERENCES = new Set(["system", "light", "dark"]);
  const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function normalizePreference(value) {
    return VALID_PREFERENCES.has(value) ? value : "system";
  }

  function getPreference() {
    try {
      return normalizePreference(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return "system";
    }
  }

  function applyPreference(preference) {
    const normalized = normalizePreference(preference);

    if (normalized === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = normalized;
    }

    return normalized;
  }

  function persistPreference(preference) {
    const normalized = normalizePreference(preference);

    try {
      if (normalized === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      }
    } catch {
      // The theme still applies for the current page if local storage is unavailable.
    }

    return applyPreference(normalized);
  }

  function describePreference(preference) {
    if (preference === "system") {
      const activeTheme = systemThemeQuery.matches ? "dark" : "light";
      return `Following the system theme. ${activeTheme[0].toUpperCase()}${activeTheme.slice(1)} mode is currently active.`;
    }

    return `Using ${preference} mode on this browser profile.`;
  }

  function updateSettingsControls(preference = getPreference()) {
    const normalized = normalizePreference(preference);
    const controls = document.querySelectorAll('input[name="themePreference"]');

    for (const control of controls) {
      control.checked = control.value === normalized;
    }

    const status = document.getElementById("themePreferenceStatus");
    if (status) status.textContent = describePreference(normalized);
  }

  function bindSettingsControls() {
    const controls = document.querySelectorAll('input[name="themePreference"]');
    if (!controls.length) return;

    updateSettingsControls();

    for (const control of controls) {
      control.addEventListener("change", () => {
        if (!control.checked) return;
        const preference = persistPreference(control.value);
        updateSettingsControls(preference);
      });
    }
  }

  applyPreference(getPreference());

  window.SumTabsTheme = {
    getPreference,
    setPreference: persistPreference,
    applyPreference,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSettingsControls, { once: true });
  } else {
    bindSettingsControls();
  }

  const handleSystemThemeChange = () => {
    if (getPreference() !== "system") return;
    applyPreference("system");
    updateSettingsControls("system");
  };

  if (typeof systemThemeQuery.addEventListener === "function") {
    systemThemeQuery.addEventListener("change", handleSystemThemeChange);
  } else {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const preference = applyPreference(getPreference());
    updateSettingsControls(preference);
  });
})();
