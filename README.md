# SumTabs – Domain-Aware Tab Grouping Extension

SumTabs is a Chrome/Chromium extension that helps tame tab overload by automatically grouping related tabs together. It watches new tabs and navigation events, infers a *group identity* from each tab’s hostname, and uses the built-in Tab Groups API to collect matching tabs under a common banner.

The extension runs entirely in the browser — no network calls, no analytics — and keeps its configuration in Chrome’s sync storage.

---

## Features

### Domain-Based Grouping

- **Automatic grouping by root domain.**  
  New tabs are grouped based on the registrable portion of their hostname (e.g. `docs.google.com` and `mail.google.com` fall under `google.com`). IPv4 addresses and multipart TLDs are handled correctly. Group titles are prefixed with `∑ `.

- **Configurable grouping threshold.**  
  Choose how many matching tabs must exist in the same window before SumTabs creates a new managed group. The default is `2`.

- **Strict membership enforcement.**  
  When a tab changes URL, SumTabs verifies that it still belongs in its current group. If the hostname no longer matches the group identity, the tab is ungrouped and reassigned if appropriate.

- **Focus mode.**  
  When enabled, navigating or creating a tab collapses all other groups in the window so the active group remains expanded.

- **Singleton managed-group behavior (optional).**  
  You can choose what happens when a managed `∑ ` group drops to one tab. By default, the singleton group remains. If enabled, SumTabs ungroups the lone tab so the group is removed until grouping conditions are met again.

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

- **Ignored hostnames.**
  Keep exact hostnames completely unmanaged. Matching is case-normalized but does not inherit from a parent to its subdomains or from a subdomain to its parent. Ignore rules have absolute precedence over custom bundles (including path-scoped rules), exact-host separation, domain-wide separation, and normal root-domain grouping. This functional setting is saved in `chrome.storage.sync`.
  The popup includes an active-site toggle for adding or removing the current hostname from this list without opening Settings.

- **Advanced JSON editing.**  
  A collapsible section in the settings page allows direct editing of the custom bundle configuration in JSON format.

### Path-scoped bundle rules

Custom bundle entries can include optional path prefixes in addition to hostnames.

- `chatgpt.com/codex` and `chatgpt.com/codex/*` are treated equivalently.
- Matching is prefix-based on `URL.pathname` boundaries (case-insensitive), so `/codex` matches `/codex`, `/Codex/agents`, and `/codex/agents`, but not `/codexx`.
- Rules are canonicalized on save/load so equivalent forms collapse to one normalized entry.

Precedence when multiple bundle rules overlap:

1. Exact hostname rules are evaluated before inherited root-domain bundle rules.
2. For same-host matches, path-scoped rules beat host-only rules.
3. Longer path prefixes win over shorter prefixes; ties keep declaration order.

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
- Set **Group when at least this many matching tabs exist** to control when grouping starts (minimum `2`, default `2`).
- Toggle **Ungroup managed groups when only one tab remains** to remove singleton managed groups automatically (default is off, so singleton managed groups remain grouped).
- Toggle **Ignore a tab’s initial URL while grouping and enforcing placement** to wait until newly created tabs navigate away from temporary initial pages before grouping or enforcing their placement.
- Add entries under **Domain-wide subdomain separation rules** (one per line) to keep matching subdomain families separate when needed.
- Add **Exact-host separation rules** (one per line) to keep specific hosts separate from their broader domain grouping.
- Add hostnames under **Ignore these specific hostnames** (one per line), then select **Save changes**, to keep exact matches unmanaged. Reset loads the empty default into the editor; save to persist it.
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

### Known limitation: tab changes during forced reevaluation

SumTabs preserves the tab that was active when forced reevaluation began. If the user changes tabs while reevaluation is still running, SumTabs may restore the earlier tab when processing completes. Chromium does not currently expose enough activation-origin information for SumTabs to distinguish that user selection reliably from grouping-induced or extension-induced activation.

This race condition is intentionally accepted because avoiding it with heuristic event tracking could make active-tab preservation less reliable. See [issue #98](https://github.com/Palmer-LOL/SumTabs/issues/98) for the technical rationale and conditions for revisiting the decision.

---

## License

This project is licensed under the **[Do What The Fuck You Want To Public License (WTFPL v2)](https://www.wtfpl.net)**.

---

## Development Testing

Automated testing is split into two deliberately separate layers:

- **Vitest unit tests** cover deterministic pure JavaScript contracts such as grouping identity resolution, multipart suffix behavior, custom bundle parsing, path-scoped bundle precedence, settings textarea parsing, custom bundle normalization, and persistence payload construction.
- **Playwright smoke tests** load the actual unpacked Manifest V3 extension into bundled Chromium and verify a small set of browser-integration contracts involving the background service worker, `chrome.tabs`, `chrome.tabGroups`, `chrome.storage.sync`, and extension pages.

The extension itself remains directly loadable as an unpacked Chromium extension. Normal extension use does **not** require npm installation, Node.js, a build step, bundling, or transpilation.

### Requirements

- Node.js `20.19.0` or newer for local development tests.
- npm, using the committed `package-lock.json` for repeatable dependency installation.
- Playwright's bundled Chromium browser for the smoke suite.

### Install development dependencies

Use the committed lockfile for repeatable installs:

```sh
npm ci
```

Install the Playwright-managed Chromium browser explicitly when you want to run browser smoke tests:

```sh
npx playwright install chromium
```

The downloaded browser is a local development artifact and must not be committed.

### Run the unit tests once

```sh
npm run test:run
```

### Run tests in watch mode

```sh
npm test
```

### Run the Playwright smoke tests

```sh
npm run test:e2e
```

For local debugging with a visible browser:

```sh
npm run test:e2e:headed
```

### Run the combined automated suite

```sh
npm run test:all
```

### Current automated coverage

The Vitest suite covers pure grouping and settings-validation contracts, including root-domain resolution, multipart suffix handling, custom bundle rule parsing, path-scoped bundle precedence, bundle conflict/owner helpers, hostname normalization, settings textarea parsing, custom bundle normalization, persistence payload construction, and raw JSON coercion.

The Playwright smoke suite covers only a small number of real Chromium integration paths:

- The unpacked Manifest V3 extension loads in an isolated persistent Chromium context.
- The background service worker starts and exposes a discoverable extension ID.
- A settings extension page can be opened from the extension origin.
- Two eligible local HTTP tabs can form a managed `∑ ` tab group through Chromium tab APIs.
- A single eligible HTTP tab remains ungrouped in the smoke scenario.
- A pinned matching tab remains pinned and outside tab groups while unpinned matching tabs group.
- A user-created, non-prefixed tab group remains protected during an explicit reevaluation.
- The popup page can be loaded directly by extension URL and its core controls/modules are present.
- The settings page can save the grouping threshold and canonical ignored-hostname rules through the real UI, persist them to `chrome.storage.sync`, and reload them.

The Playwright tests use a loopback HTTP server and isolated browser profiles. They do not depend on public websites or a developer's normal browser profile.

### Still requiring manual or future automated verification

Automated browser smoke tests do **not** replace manual validation in a real supported Chromium browser. In particular, they do not fully cover:

- Actual toolbar-popup activation behavior or active-tab detection from the browser toolbar.
- Supported-browser differences in Chrome, Brave, and Edge.
- Visual layout, text wrapping, theme quality, and responsive behavior.
- Keyboard navigation and practical focus visibility.
- Screen-reader announcements and interaction flow.
- Permission presentation in browser extension-management UI.
- Human usability of destructive actions, confirmation language, and settings workflows.
- Collapse behavior across all focus/navigation cases.
- Strict membership enforcement for every navigation and custom-rule scenario.
- Cross-window grouping isolation beyond the pure unit contracts and manual checks.
- Any core invariant not explicitly asserted by a Vitest or Playwright test.

Treat Playwright as a smoke-test foundation for critical browser integration, not as exhaustive end-to-end coverage.
