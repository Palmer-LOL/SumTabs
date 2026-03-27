# SumTabs – Domain-Aware Tab Grouping Extension

SumTabs is a Chrome/Chromium extension that helps tame tab overload by automatically grouping related tabs together. It watches new tabs and navigation events, infers a *group identity* from each tab’s hostname, and uses the built-in Tab Groups API to collect matching tabs under a common banner.

The extension runs entirely in the browser — no network calls, no analytics — and keeps its configuration in Chrome’s sync storage.

---

## Features

### Domain-Based Grouping

- **Automatic grouping by root domain.**  
  New tabs are grouped based on the registrable portion of their hostname (e.g. `docs.google.com` and `mail.google.com` fall under `google.com`). IPv4 addresses and multipart TLDs are handled correctly. Group titles are prefixed with `∑ `.

- **Strict membership enforcement.**  
  When a tab changes URL, SumTabs verifies that it still belongs in its current group. If the hostname no longer matches the group identity, the tab is ungrouped and reassigned if appropriate.

- **Focus mode.**  
  When enabled, navigating or creating a tab collapses all other groups in the window so the active group remains expanded.

- **Singleton managed-group behavior (optional).**  
  You can choose what happens when a managed `∑ ` group drops to one tab. By default, the singleton group remains. If enabled, SumTabs ungroups the lone tab so the group is removed until grouping conditions are met again.

---

### Pinned Tab Startup + Enforcement (Optional)

- **Optional pinned-tab enforcement.**  
  Use a user-defined list of hostnames/URLs to manage pinned tabs in normal windows:
  - **Create pinned tabs on new window.** On each newly created normal window, SumTabs opens pinned tabs for each configured entry and does not continuously reconcile afterward.
  - **Enforce pinned tabs continuously.** SumTabs continuously ensures at least one pinned tab exists per configured hostname in every normal window. Matching is by hostname only (path/query/hash ignored).

---

### Custom Grouping Rules

- **Custom bundles.**  
  Define your own bundles of hostnames under a single title.  
  Example: A “News” bundle containing `nytimes.com` and `theatlantic.com`.  
  Tabs matching any listed domain will be grouped together under `∑ News`. You can also assign a specific tab-group color per bundle.

- **Domain-wide subdomain separation rules.**  
  Includes a configurable list (e.g. `co.uk`, `com.au`) used to keep whole subdomain families separated when a shared suffix would otherwise collapse them together. You can extend this list on the settings page.

- **Exact-host separation rules.**  
  Keep specific hostnames (e.g. `docs.google.com`) separate from their broader domain grouping.

- **Advanced JSON editing.**  
  A collapsible section in the settings page allows direct editing of the custom bundle configuration in JSON format.

---

## Privacy & Permissions

- **Local-only processing.**  
  All URL parsing and grouping logic runs locally in your browser.

- **No telemetry.**  
  SumTabs does not transmit data, include analytics, or load remote code.

- **Chrome sync storage.**  
  Settings are stored using `chrome.storage.sync`. If Chrome Sync is enabled, settings may sync across devices as part of your browser profile.

---

## Usage

Once installed, SumTabs begins grouping tabs automatically.

Open multiple tabs from the same domain (or matching a custom bundle) and they will be grouped together under a prefixed identity

To configure behavior:

- Open the extension popup and click **Open Settings**.
- Toggle **Collapse other groups when navigating/creating tabs** to enable or disable focus mode.
- Toggle **Ungroup managed groups when only one tab remains** to remove singleton managed groups automatically (default is off, so singleton managed groups remain grouped).
- Toggle **Ignore initial tab URL for grouping** and **Ignore initial tab URL for enforcement** to avoid grouping while tabs are still on their initial load.
- Configure **Pinned tab hostnames or URLs** (one per line).
- Enable **Create pinned tabs on new window** to seed new normal windows with pinned tabs.
- Enable **Enforce pinned tabs continuously** to keep pinned tabs present by hostname (regardless of URL path) without stealing focus.
- Add entries under **Domain-wide subdomain separation rules** (one per line) to keep matching subdomain families separate when needed.
- Add **Exact-host separation rules** (one per line) to keep specific hosts separate from their broader domain grouping.
- Use the **Custom domain bundles** editor to create/manage domain groupings and optionally choose a bundle color.

---

## Code Structure

- **`background.js`**  
  Core grouping logic. Listens to tab creation, updates, activation, and window focus events. Includes throttling and re-entrancy safeguards to prevent event storms.

- **`defaults.js`**  
  Defines default settings, including prefix, collapse flags, backward-compatible separation-rule defaults, and custom bundles.

- **`settings.html` + `settings.js`**  
  Implements the options page UI and storage logic. Uses semantic, BEM-style class names (e.g. `.settings__row`, `.bundle-editor__toolbar`).

- **`popup.html` + `popup.js`**  
  Minimal popup providing access to the settings page.

- **`style.css`**  
  Centralized stylesheet using CSS custom properties for shared design tokens (fonts, spacing, colors). Organized into layout blocks, component blocks, and modifiers using a BEM-style convention for maintainability.

---

## Browser Compatibility

SumTabs targets Chromium-based browsers that support the Tab Groups API (e.g. Chrome, Brave, Edge). Firefox does not currently support this API.

---

## License

This project is licensed under the **[Do What The Fuck You Want To Public License (WTFPL v2)](https://www.wtfpl.net)**.
