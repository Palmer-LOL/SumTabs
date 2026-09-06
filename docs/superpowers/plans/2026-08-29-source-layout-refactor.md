# SumTabs Source Layout Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize SumTabs into the approved feature-first `src/` and
`assets/` layout, split the background, popup, and settings orchestrators, and
prove every shipped reference resolves without changing extension behavior.

**Architecture:** Keep `manifest.json` at the repository root so the root
remains directly loadable as an unpacked extension. Place pure behavior in
`src/core`, shared presentation assets in `src/ui`, and page/service-worker code
in feature directories. Use explicit initialization and dependency injection at
feature boundaries so mutable state has one owner and the module graph remains
acyclic.

**Tech Stack:** Manifest V3, JavaScript ES modules, HTML/CSS, Chrome extension
APIs, Vitest 3.2.7, Playwright 1.61.1, Node.js 20.19.0 or newer.

**Spec:** `docs/superpowers/specs/2026-08-29-source-layout-design.md`

## Global Constraints

- Base and eventual PR target: `origin/sourcestructure_082826` at plan creation
  (`ffe8b4ad0ab5f7338a0536b6a5d8646e4c70a444`).
- Work only on the isolated `refactor/source-layout` worktree branch.
- Keep the managed prefix exactly `∑ `, including its trailing space.
- Only HTTP and HTTPS tabs are eligible; do not broaden protocol handling.
- Pinned tabs remain completely untouched.
- Preserve user-created groups, per-window grouping, thresholds, grouping
  precedence, strict membership, collapse, singleton, and active-tab behavior.
- Preserve all `chrome.storage.sync` keys, unknown keys, lock names, queues,
  listener timing, callback response shapes, and the narrow appearance-only
  `localStorage` exception.
- Keep the extension local-only; add no network calls, telemetry, analytics,
  remote configuration, remote code, runtime dependency, or development
  dependency.
- Add no build step, bundler, transpiler, or TypeScript.
- Keep `manifest.json` at the root and `background.type` equal to `module`.
- Keep manifest version `0.33.3`; the specification commit already performed
  the required patch increment. Do not change `package.json` version.
- Use TDD for new helpers and integrity behavior: write the test, observe the
  intended failure, implement, and observe green.
- Every task ends in a focused commit and a separate task-review gate. Do not
  dispatch two implementation agents concurrently because tasks share paths.
- Playwright was initially blocked by an unavailable Chromium download. Retry
  with a longer connection timeout; if unavailable, report the exact blocker
  and never claim browser coverage passed.

---

### Task 1: Shared Core and UI Foundation

**Files:**
- Create: `tests/unit/urls.test.js`
- Create: `src/core/urls.js`
- Move: `defaults.js` → `src/core/defaults.js`
- Move: `grouping.js` → `src/core/grouping.js`
- Move: `style.css` → `src/ui/base.css`
- Move: `theme.css` → `src/ui/theme.css`
- Move: `theme.js` → `src/ui/theme.js`
- Create temporarily: `defaults.js`
- Create temporarily: `grouping.js`
- Modify: `background.js`
- Modify: `popup.js`
- Modify: `settings-validation.js`
- Modify: `popup.html`
- Modify: `settings.html`
- Modify: `tests/unit/grouping.test.js`

**Interfaces:**
- Produces: `safeParseUrl(value): URL | null` from `src/core/urls.js`.
- Produces: `isWebUrl(value): boolean` from `src/core/urls.js`.
- Preserves every existing export from `src/core/defaults.js` and
  `src/core/grouping.js` unchanged.
- Temporary root shims re-export the core modules and are removed in Task 5.

- [ ] **Step 1: Write URL-helper tests before the shared module exists**

Create `tests/unit/urls.test.js` with literal inputs and outcomes:

```js
import { describe, expect, it } from "vitest";
import { isWebUrl, safeParseUrl } from "../../src/core/urls.js";

describe("safeParseUrl", () => {
  it("returns URL instances for valid HTTP and HTTPS inputs", () => {
    expect(safeParseUrl("http://example.test/path")?.href)
      .toBe("http://example.test/path");
    expect(safeParseUrl("https://example.test/")?.protocol).toBe("https:");
  });

  it("returns null for malformed or empty input", () => {
    expect(safeParseUrl("not a URL")).toBeNull();
    expect(safeParseUrl("")).toBeNull();
    expect(safeParseUrl(undefined)).toBeNull();
  });
});

describe("isWebUrl", () => {
  it.each(["http://example.test", "https://example.test"])(
    "accepts the supported web URL %s",
    (value) => expect(isWebUrl(safeParseUrl(value))).toBe(true),
  );

  it.each([
    "chrome://extensions",
    "edge://extensions",
    "file:///tmp/example",
    "about:blank",
    "chrome-extension://abcdefghijklmnop/page.html",
    "data:text/plain,hello",
    "ftp://example.test/file",
  ])("rejects the unsupported URL %s", (value) => {
    expect(isWebUrl(safeParseUrl(value))).toBe(false);
  });

  it("rejects null", () => expect(isWebUrl(null)).toBe(false));
});
```

- [ ] **Step 2: Verify the URL-helper test fails for the intended reason**

Run:

```sh
npx vitest run tests/unit/urls.test.js
```

Expected: FAIL because `src/core/urls.js` does not exist. A syntax or unrelated
configuration failure is not an acceptable RED result.

- [ ] **Step 3: Move core files and implement the shared URL API**

Use `git mv` for the existing files. Create `src/core/urls.js` with:

```js
export function safeParseUrl(urlString) {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

export function isWebUrl(url) {
  return url?.protocol === "http:" || url?.protocol === "https:";
}
```

Create temporary root compatibility modules containing only:

```js
// defaults.js
export * from "./src/core/defaults.js";
```

```js
// grouping.js
export * from "./src/core/grouping.js";
```

- [ ] **Step 4: Replace duplicated URL helpers without changing callers**

In root `background.js` and `popup.js`, import `safeParseUrl` and `isWebUrl`
from `./src/core/urls.js`, delete only the duplicate local definitions, and
leave every call site unchanged.

- [ ] **Step 5: Move shared presentation files and update the active root pages**

Move the three files into `src/ui/` without editing their contents. Update the
root pages to use these exact paths:

```html
<script src="src/ui/theme.js"></script>
<link rel="stylesheet" href="src/ui/base.css" />
<link rel="stylesheet" href="src/ui/theme.css" />
```

Keep `src/ui/theme.js` a classic synchronous script before stylesheet links.

- [ ] **Step 6: Update direct core imports**

Update `settings-validation.js` to import grouping helpers from
`./src/core/grouping.js`. Update `tests/unit/grouping.test.js` to import from
`../../src/core/grouping.js`. Other active root modules may continue using the
temporary root shims until their feature task.

- [ ] **Step 7: Verify green and the still-active unpacked paths**

Run:

```sh
npx vitest run tests/unit/urls.test.js tests/unit/grouping.test.js tests/unit/settings-validation.test.js
npm run test:run
node --check background.js
node --check popup.js
git diff --check
```

Expected: 3 Vitest files pass, the complete unit suite passes, syntax checks
exit zero, and no whitespace errors are reported.

- [ ] **Step 8: Commit the shared foundation**

```sh
git add defaults.js grouping.js background.js popup.js settings-validation.js \
  popup.html settings.html src tests/unit
git commit -m "refactor: establish shared source modules"
```

---

### Task 2: Background Service-Worker Split

**Files:**
- Create: `src/background/index.js`
- Create: `src/background/settings-state.js`
- Create: `src/background/chrome-groups.js`
- Create: `src/background/tab-controller.js`
- Delete: `background.js`
- Modify: `manifest.json`
- Modify: `tests/e2e/fixtures.js`
- Modify: `tests/e2e/extension-smoke.spec.js`

**Interfaces:**
- `createSettingsState({ chromeApi, navigatorRef, defaults }): SettingsState`
- `SettingsState.startInitialLoad(): Promise<void>`
- `SettingsState.awaitReady(): Promise<void>`
- `SettingsState.reload(): Promise<void>`
- `SettingsState.getRuntime(): RuntimeSettings`
- `SettingsState.handleStorageChange(changes, area,
  enqueueForceReevaluation): void`
- `SettingsState.enqueueIgnoredHostnameUpdate(hostname, shouldIgnore,
  enqueueForceReevaluation): Promise<void>`
- `SettingsState.updateIgnoredHostnameWithLock(hostname, shouldIgnore,
  enqueueForceReevaluation): Promise<void>`
- `createChromeGroups({ chromeApi, getManagedPrefix }): ChromeGroups`
- `createTabController({ chromeApi, settingsState, chromeGroups }): TabController`
- `TabController` exposes the exact event operations listed in Step 4.
- `TabController.handleRuntimeMessage(message): Promise<object> | null` returns
  `null` for unrecognized messages.

- [ ] **Step 1: Record the current background function ownership map**

Use this exact mapping when moving existing bodies:

| Target | Existing functions/state |
|---|---|
| `settings-state.js` | settings snapshot, derived sets/scalars/maps, `rebuildDerived`, `loadSettings`, ignored signature/update queue/change waiters, storage lock name |
| `chrome-groups.js` | mutation lock, group-title cache, ownership classification, title/color/collapse helpers, render workaround, managed ungrouping, singleton cleanup operations, front-placement operations, and low-level group mutations |
| `tab-controller.js` | debounce/initial/last URL/window state, grouping resolution, match discovery, enforcement, grouping, decisions about when to invoke singleton/front operations, activation/collapse, reevaluation queue and all tab/window operations |
| `index.js` | every Chrome listener registration and response wiring |

Do not move a mutable state variable into two modules.

- [ ] **Step 2: Create `settings-state.js` as a leaf of the controller graph**

Implement a side-effect-free synchronous factory. Its returned
`startInitialLoad()` begins the same initial
`chrome.storage.sync.get(DEFAULTS)` load as the current module and stores the
promise awaited by `awaitReady()`. The returned object must expose:

```js
{
  startInitialLoad,
  awaitReady,
  reload,
  getRuntime,
  handleStorageChange,
  enqueueIgnoredHostnameUpdate,
  updateIgnoredHostnameWithLock,
}
```

`getRuntime()` returns defensive copies: new Sets for every Set, new Maps for
every Map, and cloned nested bundle-rule arrays/objects. Callers must never
receive or mutate the settings state's owned collections.

Construction receives `navigatorRef` so
`updateIgnoredHostnameWithLock()` preserves this exact sequence:

```text
acquire sumtabs:ignored-hostnames-storage lock
→ enqueue serialized ignored-host update
→ write chrome.storage.sync
→ receive matching storage.onChanged event
→ await queued full reevaluation
→ resolve the runtime-message response
```

`getRuntime()` returns the current derived values needed by the controller:

```js
{
  commonMultipartSuffixes,
  excludedFromRootCollapse,
  ignoredHostnames,
  autoGroupPrefix,
  minTabsToGroup,
  collapseOtherGroupsOnNavEvents,
  keepManagedGroupsAtFront,
  ungroupSingletonManagedGroups,
  ignoreInitialTabUrl,
  customBundleMaps,
  customIdentityToColor,
}
```

Preserve the exact legacy-key conjunction for `ignoreInitialTabUrl`, ignored
hostname canonicalization, valid group colors, lock name, signature ordering,
and waiter completion after reevaluation.

- [ ] **Step 3: Create `chrome-groups.js` with guarded Chrome operations**

Move the existing function bodies without changing their catch behavior or API
arguments. The factory owns `mutationLockUntil` and `groupTitleCache` and
returns this explicit API:

```js
{
  underMutationLock,
  acquireMutationLock,
  getGroupTitle,
  classifyGroupOwnership,
  classifyTabGroup,
  ensureGroupTitle,
  ensureGroupColor,
  setGroupCollapsed,
  expandGroupIfCollapsed,
  runChromiumGroupTitleRenderWorkaround,
  ungroupManagedTab,
  cleanupManagedSingletonGroupsInWindow,
  keepManagedGroupsAtFrontInWindow,
  handleGroupRemoved,
  handleGroupUpdated,
}
```

`handleGroupRemoved(group)` deletes the cached title and
`handleGroupUpdated(group)` stores `group.title ?? null`. The controller decides
when cleanup/front placement is required and passes the relevant enabled
setting; the Chrome operations themselves remain here.

The managed-title predicate obtains the live prefix through
`getManagedPrefix()`. It must not import `settings-state.js`.

- [ ] **Step 4: Create `tab-controller.js` and preserve event contracts**

The returned controller exposes these exact operations:

```js
{
  enqueueForceReevaluation,
  handleTabCreated,
  handleTabUpdated,
  handleTabActivated,
  handleTabRemoved,
  handleWindowFocusChanged,
  handleTabGroupRemoved,
  handleTabGroupUpdated,
  handleRuntimeMessage,
}
```

Move the relevant existing bodies, preserving `TAB_DEBOUNCE_MS = 750`, cache
cleanup cadence, mutation-lock timing, initial-URL tracking, active-tab restore,
ignored-host precedence, singleton cleanup, and error isolation.

`handleRuntimeMessage` recognizes only:

```text
sumtabs:force-reevaluate
sumtabs:update-ignored-hostname
```

It returns `null` for everything else and otherwise returns a promise resolving
to `{ ok: true }` or `{ ok: false, error: String(error) }`. Preserve the
existing console error text on failure. The ignored-host message calls
`settingsState.updateIgnoredHostnameWithLock()` so the shared lock surrounds
the same queued update promise as the current implementation.

- [ ] **Step 5: Create the listener-only `index.js`**

Construct settings state, one Chrome-groups instance, and the controller
synchronously. Inject the Chrome-groups instance into the controller. Preserve
the current initialization order exactly:

1. Register startup and installation reload listeners.
2. Register the storage-change listener.
3. Call `settingsState.startInitialLoad()`.
4. Register tab, window, tab-group, and runtime-message listeners.

`runtime.onMessage` must preserve asynchronous response channel behavior:

```js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const response = controller.handleRuntimeMessage(message);
  if (!response) return undefined;
  response.then(sendResponse);
  return true;
});
```

Startup and installation listeners call `settingsState.reload()`. Storage
changes call `settingsState.handleStorageChange` with
`controller.enqueueForceReevaluation`. Tab-group listeners forward to the
controller cache operations. Do not add import-time listeners to leaf modules.

- [ ] **Step 6: Cut the manifest and E2E worker path over atomically**

Set:

```json
"background": {
  "service_worker": "src/background/index.js",
  "type": "module"
}
```

Add these constants to `tests/e2e/fixtures.js` and export them:

```js
export const backgroundPath = "src/background/index.js";
export const settingsPath = "settings.html";
export const popupPath = "popup.html";
```

Replace the three fixture-internal `settings.html` literals immediately with
`settingsPath`. Use `backgroundPath` in `extension-smoke.spec.js` and delete
root `background.js` only after the manifest no longer references it.

- [ ] **Step 7: Verify the background split**

Run:

```sh
find src/background -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:run
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx playwright install chromium
npm run test:e2e
git diff --check
```

If browser installation remains blocked, record the complete error and continue
only with unit/static evidence; do not relabel the blocked E2E command as a
pass. The task report must explicitly state whether the ignored-host
acknowledgement, settings/popup lock, and queued-popup-close scenarios executed.

- [ ] **Step 8: Commit the background split**

```sh
git add manifest.json src/background tests/e2e background.js
git commit -m "refactor: split background service worker"
```

---

### Task 3: Popup Feature Split

**Files:**
- Move: `popup.html` → `src/popup/popup.html`
- Create: `src/popup/index.js`
- Create: `src/popup/active-tab-status.js`
- Create: `src/popup/quick-actions.js`
- Move/refactor: `window-actions.js` → `src/popup/window-actions.js`
- Move/refactor: `window-summary.js` → `src/popup/window-summary.js`
- Move: `popup-ui.css` → `src/popup/popup.css`
- Move: `window-actions.css` → `src/popup/window-actions.css`
- Delete: `popup.js`
- Delete: `popup-ui.js`
- Modify: `manifest.json`
- Modify: `tests/e2e/fixtures.js`
- Modify: `tests/e2e/extension-smoke.spec.js`
- Modify: `tests/e2e/settings-smoke.spec.js`

**Interfaces:**
- `getActiveTabStatus({ chromeApi, defaults }): Promise<{ status, context }>`
- `createQuickActions({ chromeApi, elements, announce, refresh }): QuickActions`
- `QuickActions.bind(): void`
- `QuickActions.render(context): void`
- `initWindowActions({ chromeApi, documentRef }): Promise<void>`
- `initWindowSummary({ chromeApi, documentRef }): Promise<void>`

- [ ] **Step 1: Extract active-tab analysis without storage writes**

Move the safe status computation from `renderActiveTabStatus` and its pure
helpers into `active-tab-status.js`. `status` has exact keys
`hostname`, `target`, and `explanation`. `context` has these exact keys:

```js
{
  hostname,
  ignoreActionEnabled,
  exactActionEnabled,
  domainActionAvailable,
  domainActionEnabled,
  domainActionAffectsCurrentTab,
  domainActionLabel,
  domainActionToken,
  customDomainGroups,
  bundleMembershipByIndex,
  bundleOwners,
}
```

This module reads the active tab and settings but never writes storage or
imports `quick-actions.js`.

- [ ] **Step 2: Extract quick-action state and mutations**

Move `quickActionContext`, in-flight state, normalization, ignore/exact/domain
toggles, bundle membership writes, and their render/busy behavior into
`quick-actions.js`. Preserve the runtime ignored-host message, the shared lock
behavior in the background, button labels, disabled states, and feedback text.
Receive `refresh` from `index.js`; do not import `active-tab-status.js`.

- [ ] **Step 3: Convert window modules to explicit initialization**

Replace top-level initialization side effects with exported functions:

```js
export async function initWindowActions({
  chromeApi = chrome,
  documentRef = document,
} = {}) { /* existing initialization and first refresh */ }
```

```js
export async function initWindowSummary({
  chromeApi = chrome,
  documentRef = document,
} = {}) { /* existing installation, observers, and first refresh */ }
```

Keep their duplicated window inspection logic unchanged. Change the runtime
stylesheet reference to:

```js
chrome.runtime.getURL("src/popup/window-actions.css")
```

- [ ] **Step 4: Merge popup UI coordination into `index.js`**

Move all behavior from `popup-ui.js` into named functions in `index.js`,
including exclusive disclosure sections, `bindRuleToggle`, and both
MutationObservers. Initialize in this order:

1. Cache DOM elements and create quick actions.
2. Bind popup controls and disclosure/toggle coordination.
3. Await `initWindowActions()`.
4. Await `initWindowSummary()`.
5. Render active-tab status and quick actions.

Remove the inert legacy `closeAllUnpinnedTabsInCurrentWindow` implementation
from old `popup.js`; `window-actions.js` is the single canonical action owner.

- [ ] **Step 5: Move the popup HTML/styles and update relative paths**

Use these exact shared references from `src/popup/popup.html`:

```html
<script src="../ui/theme.js"></script>
<link rel="stylesheet" href="../ui/base.css" />
<link rel="stylesheet" href="popup.css" />
<link rel="stylesheet" href="../ui/theme.css" />
<script type="module" src="index.js"></script>
```

Remove the separate `popup-ui.js` script tag.

- [ ] **Step 6: Cut over manifest and browser-test paths**

Set `manifest.action.default_popup` to `src/popup/popup.html`. Change
`popupPath` in `tests/e2e/fixtures.js` to that exact path. Replace direct popup
path literals in `extension-smoke.spec.js` and `settings-smoke.spec.js` with the
fixture constant and update expected extension URLs. Add an
`extension-smoke.spec.js` assertion that `#closeAllUnpinnedTabs` is visible and
has either its populated `Close all N unpinned tab(s)` accessible label or its
existing empty-state accessible label. This assertion protects the canonical
replacement action while the inert legacy function is removed.

- [ ] **Step 7: Verify the popup split**

Run:

```sh
find src/popup -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:run
npm run test:e2e -- tests/e2e/extension-smoke.spec.js tests/e2e/settings-smoke.spec.js
git diff --check
```

If the browser remains unavailable, report the blocker exactly and retain the
manual toolbar-popup/style checks for final handoff.

- [ ] **Step 8: Commit the popup split**

```sh
git add manifest.json src/popup tests/e2e popup.html popup.js popup-ui.js \
  popup-ui.css window-actions.js window-actions.css window-summary.js
git commit -m "refactor: organize popup feature modules"
```

---

### Task 4: Settings Feature Split

**Files:**
- Move: `settings.html` → `src/settings/settings.html`
- Create: `src/settings/index.js`
- Create: `src/settings/editor.js`
- Create: `src/settings/persistence.js`
- Create: `src/settings/transfer.js`
- Move/refactor: `settings-validation.js` → `src/settings/validation.js`
- Delete: `settings.js`
- Modify: `manifest.json`
- Modify: `tests/unit/settings-validation.test.js`
- Modify: `tests/e2e/fixtures.js`
- Modify: `tests/e2e/extension-smoke.spec.js`
- Modify: `tests/e2e/settings-smoke.spec.js`

**Interfaces:**
- `createSettingsEditor({ documentRef }): SettingsEditor`
- `createSettingsPersistence({ chromeApi, navigatorRef, windowRef, elements,
  editor, setStatus }): SettingsPersistence`
- `exportSettings({ chromeApi, documentRef, report }): Promise<void>`
- `importSettingsFile({ file, chromeApi, navigatorRef, windowRef, reload,
  report }): Promise<void>`
- Existing exports from `validation.js` remain unchanged.

- [ ] **Step 1: Move the pure validation leaf and its tests**

Move `settings-validation.js` to `src/settings/validation.js`; update its core
import to `../core/grouping.js`. Update
`tests/unit/settings-validation.test.js` imports to:

```js
import { /* existing names unchanged */ } from "../../src/settings/validation.js";
import { DEFAULTS } from "../../src/core/defaults.js";
```

Run the targeted unit test immediately after the move.

- [ ] **Step 2: Extract the single-owner editor module**

Move these existing responsibilities into `editor.js`: validation message
rendering, field validity, duplicate messages, full editor validation,
`customGroupsState`, selected index, JSON-draft state, pending deletion, UI
snapshot construction, JSON synchronization, structured rendering and edits,
add/remove/undo, and form population.

The returned editor object exposes the exact operations persistence/index need:

```js
{
  validateSettings,
  captureUiSnapshot,
  hasJsonDraft,
  populateForm,
  loadDefaultsIntoEditor,
  getPersistenceValues,
  bindEditorEvents,
  setGroupsState,
}
```

Do not copy editor state into persistence.

- [ ] **Step 3: Extract persistence and conflict coordination**

Move saved snapshot, loading state, ignored-host baseline/conflict state,
save-state rendering, load/save/discard/default behavior, and storage-change
handling into `persistence.js`. Preserve:

- Lock name `sumtabs:ignored-hostnames-storage`.
- Atomic latest-value conflict check plus write.
- Unknown-key preservation and partial update payloads.
- Both aligned legacy initial-URL keys.
- Current confirmation, conflict, status, and error text.
- Existing before-unload behavior through an exposed dirty-state query.

Return:

```js
{
  load,
  save,
  discardChanges,
  loadDefaults,
  updateSaveState,
  handleStorageChange,
  hasUnsavedChanges,
}
```

- [ ] **Step 4: Extract backup transfer operations**

Move the exact backup format `sumtabs-settings`, backup version `1`, JSON
serialization, download cleanup, file parsing, validation-before-write, locked
storage write, and reload behavior into `transfer.js`. Receive `reload` as a
`(): Promise<void>` callback and `report(message, state)` callback from
`index.js`; do not import persistence or editor. Preserve the exact success and
failure status text through the reporting callback.

- [ ] **Step 5: Create the settings entry point**

`index.js` caches elements, creates editor and persistence, registers
`chrome.storage.onChanged` synchronously, binds all existing events to the new
module operations, registers `beforeunload`, and finally calls `load()` with the
same top-level failure reporting. Leaf modules must not register listeners as
import-time side effects.

- [ ] **Step 6: Move HTML and update shared/module references**

Use these exact references:

```html
<script src="../ui/theme.js"></script>
<link rel="stylesheet" href="../ui/base.css" />
<link rel="stylesheet" href="../ui/theme.css" />
<script type="module" src="index.js"></script>
```

Set `manifest.options_page` to `src/settings/settings.html`. Change
`settingsPath` in `tests/e2e/fixtures.js` to that exact path and replace every
direct `settings.html` extension-page literal in the E2E suite with the shared
constant.

- [ ] **Step 7: Verify the settings split**

Run:

```sh
npx vitest run tests/unit/settings-validation.test.js
find src/settings -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:run
npm run test:e2e -- tests/e2e/extension-smoke.spec.js tests/e2e/settings-smoke.spec.js
git diff --check
```

Explicitly report whether import/export, ignored-host canonicalization,
initial-URL key alignment, unsaved-draft preservation, conflict resolution, and
popup/settings lock tests executed or remained browser-blocked.

- [ ] **Step 8: Commit the settings split**

```sh
git add manifest.json src/settings tests settings.html settings.js \
  settings-validation.js
git commit -m "refactor: organize settings feature modules"
```

---

### Task 5: Assets and Final Layout Integrity

**Files:**
- Move: `icons/16.png` → `assets/icons/16.png`
- Move: `icons/48.png` → `assets/icons/48.png`
- Move: `icons/128.png` → `assets/icons/128.png`
- Move: `SumTabs.svg` → `assets/brand/SumTabs.svg`
- Create: `tests/unit/extension-layout.test.js`
- Delete: `defaults.js`
- Delete: `grouping.js`
- Modify: `manifest.json`

**Interfaces:**
- The integrity test validates manifest, HTML, JS import/re-export,
  `chrome.runtime.getURL`, and CSS local-resource paths using Node built-ins.
- No production runtime API is added.

- [ ] **Step 1: Write the final-layout test while obsolete root files remain**

Create `tests/unit/extension-layout.test.js` with helpers that:

```js
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));

// This repository-specific static resolver intentionally does not cover
// computed imports, computed chrome.runtime.getURL arguments, generated HTML,
// or manifest fields added in the future without a corresponding test update.

function resolveInsideRoot(baseDirectory, reference) {
  const resolved = path.resolve(baseDirectory, reference);
  const relative = path.relative(repoRoot, resolved);
  expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
  return resolved;
}

function expectFile(baseDirectory, reference) {
  const resolved = resolveInsideRoot(baseDirectory, reference);
  expect(existsSync(resolved), reference).toBe(true);
  expect(statSync(resolved).isFile(), reference).toBe(true);
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(target);
    return entry.isFile() && entry.name.endsWith(".css") ? [target] : [];
  });
}

function references(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1] || match[2]);
}

const expectedIcons = {
  "16": "assets/icons/16.png",
  "48": "assets/icons/48.png",
  "128": "assets/icons/128.png",
};

const requiredFiles = [
  "src/core/defaults.js",
  "src/core/grouping.js",
  "src/core/urls.js",
  "src/ui/base.css",
  "src/ui/theme.css",
  "src/ui/theme.js",
  "src/background/index.js",
  "src/background/settings-state.js",
  "src/background/chrome-groups.js",
  "src/background/tab-controller.js",
  "src/popup/popup.html",
  "src/popup/index.js",
  "src/popup/active-tab-status.js",
  "src/popup/quick-actions.js",
  "src/popup/window-actions.js",
  "src/popup/window-summary.js",
  "src/popup/popup.css",
  "src/popup/window-actions.css",
  "src/settings/settings.html",
  "src/settings/index.js",
  "src/settings/editor.js",
  "src/settings/persistence.js",
  "src/settings/transfer.js",
  "src/settings/validation.js",
  "assets/brand/SumTabs.svg",
  "assets/icons/16.png",
  "assets/icons/48.png",
  "assets/icons/128.png",
];

const obsoleteRootPaths = [
  "SumTabs.svg",
  "background.js",
  "defaults.js",
  "grouping.js",
  "popup.html",
  "popup.js",
  "popup-ui.js",
  "popup-ui.css",
  "settings.html",
  "settings.js",
  "settings-validation.js",
  "style.css",
  "theme.css",
  "theme.js",
  "window-actions.js",
  "window-actions.css",
  "window-summary.js",
  "icons",
];

describe("extension layout", () => {
  it("uses the approved manifest entry and icon paths", () => {
    expect(manifest.background).toEqual({
      service_worker: "src/background/index.js",
      type: "module",
    });
    expect(manifest.action.default_popup).toBe("src/popup/popup.html");
    expect(manifest.options_page).toBe("src/settings/settings.html");
    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action.default_icon).toEqual(expectedIcons);
  });

  it("resolves all manifest-selected files inside the extension root", () => {
    for (const reference of [
      manifest.background.service_worker,
      manifest.action.default_popup,
      manifest.options_page,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ]) {
      expectFile(repoRoot, reference);
    }
  });

  it("resolves local scripts and stylesheets from manifest-selected pages", () => {
    for (const pagePath of [
      manifest.action.default_popup,
      manifest.options_page,
    ]) {
      const pageFile = resolveInsideRoot(repoRoot, pagePath);
      const source = readFileSync(pageFile, "utf8");
      const pageReferences = references(
        source,
        /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi,
      );

      for (const reference of pageReferences) {
        expect(reference).not.toMatch(/^(?:[a-z]+:)?\/\//i);
        expectFile(path.dirname(pageFile), reference);
      }
    }
  });

  it("resolves static source imports and exports", () => {
    const pattern =
      /(?:import\s+(?:[^"'\\]*?\s+from\s+)?|export\s+[^"'\\]*?\s+from\s+)["']([^"']+)["']/g;

    for (const sourceFile of javascriptFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        expect(reference.startsWith("."), reference).toBe(true);
        expectFile(path.dirname(sourceFile), reference);
      }
    }
  });

  it("resolves literal runtime resources from the extension root", () => {
    const pattern = /chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/g;
    const found = [];

    for (const sourceFile of javascriptFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        found.push(reference);
        expectFile(repoRoot, reference);
      }
    }

    expect(found).toContain("src/popup/window-actions.css");
  });

  it("resolves local CSS imports and URLs", () => {
    const pattern =
      /@import\s+["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;

    for (const sourceFile of cssFiles(path.join(repoRoot, "src"))) {
      const source = readFileSync(sourceFile, "utf8");
      for (const reference of references(source, pattern)) {
        if (
          reference.startsWith("data:") ||
          reference.startsWith("#") ||
          /^[a-z]+:/i.test(reference)
        ) continue;
        expectFile(path.dirname(sourceFile), reference);
      }
    }
  });

  it("contains every file required by the approved layout", () => {
    for (const reference of requiredFiles) expectFile(repoRoot, reference);
  });

  it("does not retain obsolete root runtime paths", () => {
    for (const reference of obsoleteRootPaths) {
      expect(existsSync(path.join(repoRoot, reference)), reference).toBe(false);
    }
  });
});
```

The test uses literal expected manifest paths from the spec; it never derives
those expected values from the manifest itself. Its regex scope is deliberately
limited to this repository's quoted static references and literal
`chrome.runtime.getURL()` calls.

- [ ] **Step 2: Verify RED for the final-layout contract**

Run:

```sh
npx vitest run tests/unit/extension-layout.test.js
```

Expected: FAIL specifically because the temporary root `defaults.js` and
`grouping.js`, root icons, and root branding still exist and asset manifest
paths have not moved. Fix regex/parser errors until the failures name those
layout violations.

- [ ] **Step 3: Move assets and update both manifest icon maps**

Move the binary/icon and branding files with `git mv`. Set both manifest icon
maps to:

```json
{
  "16": "assets/icons/16.png",
  "48": "assets/icons/48.png",
  "128": "assets/icons/128.png"
}
```

- [ ] **Step 4: Remove temporary shims and update any remaining imports**

Delete root `defaults.js` and `grouping.js`. Search all tracked text files for
obsolete root paths and replace only active code/test/document references:

```sh
rg -n "(^|[\"'/\`])(background|defaults|grouping|popup|popup-ui|settings|settings-validation|style|theme|window-actions|window-summary)\.(js|css|html)|icons/" \
  --glob '!docs/superpowers/**' --glob '!README.md'
```

Historical design/plan references remain valid documentation and are excluded
from this obsolete-runtime search.

- [ ] **Step 5: Verify GREEN for all static paths**

Run:

```sh
npx vitest run tests/unit/extension-layout.test.js
npm run test:run
node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8'))"
find src tests -name '*.js' -print0 | xargs -0 -n1 node --check
git diff --check
```

Expected: layout test and all unit suites pass, every syntax check exits zero,
and manifest parsing succeeds.

- [ ] **Step 6: Commit final layout enforcement**

```sh
git add manifest.json assets src tests/unit defaults.js grouping.js icons SumTabs.svg
git commit -m "test: enforce extension source layout"
```

---

### Task 6: Documentation, Full Verification, and Handoff

**Files:**
- Modify: `README.md`
- Modify only if implementation reality requires clarification:
  `docs/superpowers/specs/2026-08-29-source-layout-design.md`
- Modify only if task execution required an explicit ruling:
  `docs/superpowers/plans/2026-08-29-source-layout-refactor.md`

**Interfaces:**
- Produces no runtime interface.
- Produces final verification evidence and manual-test handoff for the PR.

- [ ] **Step 1: Update README code structure**

Replace the flat-file Code Structure section with the approved `src/core`,
`src/background`, `src/popup`, `src/settings`, `src/ui`, and `assets` ownership
summary. Preserve the statement that the repository root is directly loadable
without npm or a build step.

- [ ] **Step 2: Refresh testing documentation to match current coverage**

Document the new path-integrity and URL-helper unit coverage. Update the
Playwright list to reflect the actual 26-test suite without claiming any test
executed in this environment unless fresh output proves it.

- [ ] **Step 3: Run final static and unit verification**

Run fresh:

```sh
git diff --check
node -e "const m=JSON.parse(require('node:fs').readFileSync('manifest.json','utf8')); if(m.version!=='0.33.3') process.exit(1); console.log(m.version)"
find src tests -name '*.js' -print0 | xargs -0 -n1 node --check
find src tests -name '*.js' -print | wc -l
npm run test:run
```

Record exact file/test counts and exit codes.

- [ ] **Step 4: Retry and run the full Playwright suite**

Run:

```sh
PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=120000 npx playwright install chromium
npm run test:e2e
```

If installation succeeds, report exact pass/fail counts and investigate every
failure through the systematic-debugging workflow. If installation remains
blocked, preserve the exact error and mark browser automation unavailable—not
passing and not a product regression.

- [ ] **Step 5: Perform the final tracked-reference audit**

Run:

```sh
git ls-files
rg -n "chrome\.runtime\.getURL|<script[^>]+src=|<link[^>]+href=|\b(?:import|export)\b.*['\"]\." \
  manifest.json src tests README.md
git status --short
git log --oneline origin/sourcestructure_082826..HEAD
```

Review each returned runtime path. Before Step 6, `git status --short` must
show only the intended README/spec/plan changes; investigate any other path.

- [ ] **Step 6: Commit documentation**

```sh
git add README.md docs/superpowers
git commit -m "docs: describe feature-first source layout"
```

Run `git status --short` again and require empty output. Then run:

```sh
git log --oneline origin/sourcestructure_082826..HEAD
```

- [ ] **Step 7: Complete subagent review gates**

After every task commit, the controller creates an exact base-to-head review
package and dispatches a fresh task reviewer. Before branch completion,
dispatch a fresh whole-branch reviewer against:

```text
origin/sourcestructure_082826..HEAD
```

Resolve and re-review every critical or important finding. Adjudicate minor
findings explicitly rather than silently ignoring them.

- [ ] **Step 8: Prepare the PR and manual checklist**

Target `sourcestructure_082826`. The PR description must include:

- Summary of the feature-first layout and module splits.
- Overall High risk because event listeners/storage coordination moved.
- Patch-version rationale for `0.33.3`.
- Exact files/directories moved and created.
- Exact automated commands/results and behaviors they cover.
- Browser tests not run or unavailable, with the precise blocker.
- Coverage uncertainties.
- This manual checklist, explicitly unperformed unless the user reports it:
  unpacked root load; worker console; real toolbar popup/options navigation;
  light/dark/system presentation; keyboard/focus/accessibility; grouping and
  singleton behavior; cross-window isolation; user-created groups; pinned
  tabs; non-HTTP(S) protocols; strict membership; collapse; custom rule
  precedence; settings persistence/unknown keys; save/discard/defaults;
  import/export; popup/settings conflicts; extension reload persistence.
