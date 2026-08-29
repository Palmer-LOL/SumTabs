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
- Toggle **Ignore a tab’s initial URL while grouping and enforcing placement** to prevent SumTabs from grouping, reassigning, or enforcing placement for a newly created tab while it remains on the HTTP(S) URL with which it was created. The tab can remain in an existing group during this exemption unless its hostname is listed under **Ignore these specific hostnames**; that rule takes precedence and removes the tab from a managed group. Tabs created on non-HTTP(S) pages can be grouped as soon as they navigate to HTTP(S).
- Add entries under **Domain-wide subdomain separation rules** (one per line) to keep matching subdomain families separate when needed.
- Add **Exact-host separation rules** (one per line) to keep specific hosts separate from their broader domain grouping.
- Add hostnames under **Ignore these specific hostnames** (one per line), then select **Save changes**, to keep exact matches unmanaged. Reset loads the empty default into the editor; save to persist it.
- Use the **Custom domain bundles** editor to create/manage domain groupings and optionally choose a bundle color.
- Under **Advanced behavior**, use **Export settings** to download a JSON backup of synchronized settings and **Import settings** to restore one later. The device-local appearance preference is not included.

---

## Code Structure

- **`src/core/`** owns environment-independent defaults, grouping identity and custom-rule logic, and strict HTTP(S) URL helpers.
- **`src/background/`** owns the Manifest V3 service-worker entry point, synchronized settings state, low-level tab-group operations, and tab/window event coordination.
- **`src/popup/`** owns the popup page, active-tab status, quick actions, window summary/actions, and popup-specific styles.
- **`src/settings/`** owns the options page, custom-bundle editor, persistence/conflict handling, import/export, and validation.
- **`src/ui/`** owns shared base/theme styles and the synchronous theme bootstrap used by both extension pages.
- **`assets/`** contains extension icons and source branding.

`manifest.json` remains at the repository root, so the repository root is directly loadable as an unpacked Chromium extension. Normal extension use requires no npm installation, build step, bundling, or transpilation.

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

- **Vitest unit tests** cover deterministic JavaScript contracts and repository path integrity without loading a browser.
- **Playwright smoke tests** load the actual unpacked Manifest V3 extension into bundled Chromium and exercise 26 browser-integration cases involving the background service worker, `chrome.tabs`, `chrome.tabGroups`, `chrome.storage.sync`, and extension pages.

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

The Vitest suite covers:

- Grouping identity and settings-validation contracts, including root-domain resolution, multipart suffix handling, custom bundle parsing and precedence, conflict/owner helpers, hostname normalization, persistence payload construction, import validation, and raw JSON coercion.
- Shared URL helpers for safe parsing, HTTP/HTTPS acceptance, malformed input, and rejection of `chrome:`, `edge:`, `file:`, `about:`, `chrome-extension:`, `data:`, `ftp:`, and null inputs.
- Background-controller use of a freshly updated grouping threshold and popup window-action stylesheet injection through an injected Chrome API.
- Extension layout integrity: exact manifest entries and icon maps, manifest-selected resources, page scripts/stylesheets, static imports/re-exports, literal `chrome.runtime.getURL()` resources, local CSS references, the complete approved source tree, and absence of obsolete root runtime paths.

The Playwright suite currently defines 26 cases in three files:

- **2 extension startup/page cases:** unpacked MV3 startup and service-worker path; direct options-page loading by extension URL; and direct popup loading with its modules, core controls, section order, window summary, canonical close-all action, and no uncaught page errors.
- **13 grouping cases:** two-tab grouping and the single-tab threshold; pinned-tab protection; user-group protection; ignored-host exclusion; active-tab preservation at first, middle, and last positions; ignored-host acknowledgement after managed-group cleanup while preserving user groups; initial-URL exemption bypass; singleton cleanup on ignored navigation; configured collapse behavior; regrouping after returning from an ignored hostname; and immediate removal of an ignored tab created inside a managed group.
- **11 settings cases:** threshold save/reload; discard; export/import with unknown-key preservation; malformed-import rejection; ignored-host canonicalization; alignment of both legacy initial-URL keys; unsaved bundle preservation during a live ignore-list update; explicit resolution of ignore-list conflicts (including defaults); settings/popup lock coordination; and completion of a queued popup ignore update after the popup closes.

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
