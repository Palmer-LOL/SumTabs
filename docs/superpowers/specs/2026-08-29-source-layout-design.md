# SumTabs Source Layout Refactor Design

## Status

Approved in conversation on 2026-08-29. This document is the binding design
for reorganizing and splitting SumTabs source files without changing extension
behavior.

## Branch and Integration Base

The implementation branch is based on `origin/sourcestructure_082826`. At plan
creation time that branch points to
`ffe8b4ad0ab5f7338a0536b6a5d8646e4c70a444`, which is also the exact parent of
the specification commit. The eventual pull request must target
`sourcestructure_082826`, even while that branch remains identical to `main`.

## Goal

Replace the current flat repository-root runtime layout with a feature-first
`src/` hierarchy, move runtime assets under `assets/`, and split the three large
orchestrator modules into focused modules while preserving all existing
Manifest V3 behavior, storage contracts, privacy guarantees, and unpacked-load
workflow.

## Scope

This refactor includes:

- Moving all shipped JavaScript, HTML, and CSS out of the repository root.
- Moving icons and source branding into `assets/`.
- Splitting `background.js`, `popup.js`, and `settings.js` by responsibility.
- Consolidating duplicated URL parsing and HTTP(S)-eligibility helpers.
- Updating every manifest, HTML, JavaScript, test, and documentation reference.
- Adding repository-specific path-integrity tests without a new dependency.

This refactor does not include:

- User-visible behavior changes.
- Storage-schema changes or migrations.
- Permission or host-permission changes.
- New production or development dependencies.
- A build step, bundler, transpiler, or TypeScript.
- Compatibility stubs for obsolete root extension-page URLs.
- Changes to grouping identity, precedence, focus, singleton, or tab-placement
  semantics.

## Binding Repository Constraints

All requirements in the root `AGENTS.md` remain binding. In particular:

- The managed group prefix remains exactly `∑ `.
- Only HTTP and HTTPS tabs are eligible for extension behavior.
- Pinned tabs remain completely untouched.
- User-created, non-managed groups remain protected.
- Grouping remains window-scoped and threshold-controlled.
- All functional settings remain in `chrome.storage.sync`.
- `sumtabs.themePreference` remains the only permitted `localStorage` key.
- The extension remains local-only with no telemetry, analytics, network calls,
  remote configuration, or remote code.
- The background remains a Manifest V3 module service worker.
- The repository root remains directly loadable as an unpacked extension.

Because this refactor moves event listeners and storage coordination, its
repository-contract risk level is **High**, even though functional behavior is
intended to remain unchanged.

## Release Version

Increment `manifest.json` from `0.33.2` to `0.33.3`. A patch increment is
required because this is a nonfunctional internal refactor and developer-
workflow improvement. Do not change the independent npm package version.

The version is incremented in the committed design/specification change because
the repository contract also requires patch increments for documentation and
developer-workflow changes. It remains `0.33.3` for the rest of this single
unreleased refactor branch.

## Final Layout

```text
assets/
├── brand/
│   └── SumTabs.svg
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
src/
├── background/
│   ├── index.js
│   ├── settings-state.js
│   ├── chrome-groups.js
│   └── tab-controller.js
├── core/
│   ├── defaults.js
│   ├── grouping.js
│   └── urls.js
├── popup/
│   ├── popup.html
│   ├── index.js
│   ├── active-tab-status.js
│   ├── quick-actions.js
│   ├── window-actions.js
│   ├── window-summary.js
│   ├── popup.css
│   └── window-actions.css
├── settings/
│   ├── settings.html
│   ├── index.js
│   ├── editor.js
│   ├── persistence.js
│   ├── transfer.js
│   └── validation.js
└── ui/
    ├── base.css
    ├── theme.css
    └── theme.js
tests/
├── e2e/
└── unit/
```

The root retains `manifest.json`, npm metadata, test configuration,
documentation, license, repository instructions, and top-level directories.

## Dependency Direction

The final module graph follows these rules:

1. `src/core/` imports no feature module and no DOM or Chrome extension API.
2. `src/ui/` contains presentation assets and imports no feature module.
3. Feature modules may import `src/core/` and their own sibling modules.
4. Popup and settings modules do not import background implementation modules;
   they communicate through existing Chrome runtime/storage APIs.
5. Background low-level Chrome operations do not import the listener entry
   point.
6. No module imports another feature's page-specific implementation.

Circular imports are prohibited. If an extraction would require a cycle, keep
the coordinating function in the higher-level owning module rather than adding
a cross-module mutable singleton.

## Module Responsibilities

### Core

`src/core/defaults.js` owns the immutable managed marker and functional default
settings currently owned by `defaults.js`. Its exported names and values remain
unchanged.

`src/core/grouping.js` owns deterministic custom-rule parsing, bundle-map
construction, root-domain resolution, separation rules, and grouping identity
resolution currently owned by `grouping.js`. Its existing public exports and
semantics remain unchanged.

`src/core/urls.js` owns shared, pure helpers for safe URL parsing and strict
HTTP(S) eligibility. It replaces equivalent duplicated helpers in the current
background and popup modules. It must not accept additional protocols or
normalize behavior beyond the existing implementations.

### Background

`src/background/index.js` is the only background entry point and owns listener
registration for runtime startup/installation/messages, storage changes, tabs,
windows, and tab groups. It initializes the feature modules but does not own
grouping algorithms.

`src/background/settings-state.js` owns the synchronized settings snapshot,
derived sets/maps/scalars, custom bundle colors, settings readiness,
reevaluation trigger decisions, ignored-host update serialization, change
waiters, and the existing `navigator.locks`-compatible storage lock name. It exposes
narrow accessors or operations rather than exporting mutable collections for
other modules to modify.

`src/background/chrome-groups.js` owns low-level Chrome group interactions:
group-title caching and lookup, ownership classification, title/color/collapse
updates, managed ungrouping, managed-group front placement, singleton cleanup,
the Chromium group-title rendering workaround, and the shared mutation-lock
state guarding Chrome mutations. Cache invalidation remains driven by the same
tab-group events.

`src/background/tab-controller.js` owns per-tab processing state, initial/last
URL tracking, debounce state, eligibility/match discovery, membership
enforcement, grouping, activation/focus behavior, collapse behavior, the
forced-reevaluation queue, and event-handler operations invoked by `index.js`.

Settings changes must update the derived settings snapshot before requesting a
reevaluation. The ignored-hostname message must continue resolving only after
the matching storage event and its queued reevaluation complete. Preserve the
existing trigger conditions: ignored-host changes trigger reevaluation, and
enabling `keepManagedGroupsAtFront` triggers reevaluation; unrelated setting
changes must not silently gain a new full-window reevaluation.

Listener registration order, queue behavior, cache lifetime, debounce timing,
mutation-lock timing, error isolation, and callback response behavior must be
preserved. Extraction must not replace these with new scheduling semantics.

### Popup

`src/popup/index.js` owns DOM lookup, top-level page startup, event binding, and
top-level feedback/error handling. The current `popup-ui.js` disclosure
coordination and MutationObserver-based rule-toggle synchronization move here;
there is no final `popup-ui.js` module.

`src/popup/active-tab-status.js` owns active-tab retrieval, URL/grouping status
calculation, explanation text, and the normalized context consumed by quick
actions.

`src/popup/quick-actions.js` owns synchronized-setting mutations for ignore,
exact-host, domain-wide, and bundle actions, including existing normalization,
concurrency coordination, busy state, and feedback behavior.

`src/popup/window-actions.js` and `src/popup/window-summary.js` retain the
responsibilities of their current root counterparts. The stylesheet installed
through `chrome.runtime.getURL()` must use the extension-root path
`src/popup/window-actions.css`.

These modules expose explicit initialization functions instead of relying on
leaf-module top-level side effects. `index.js` initializes window actions before
window summary because the summary currently depends on action-created DOM.
Keep the two modules' existing duplicated inspection logic during this
refactor. Removing or consolidating it is out of scope.

The legacy close-all function in the current `popup.js` is inert because the
canonical window-actions UI replaces its DOM control. Remove that dead function
during the split, retain `window-actions.js` as the sole implementation, and add
or preserve a browser assertion that the replacement action remains available.

`src/popup/popup.css` contains the current popup-only styles from
`popup-ui.css`. The shared base and theme styles are referenced from
`src/ui/`.

### Settings

`src/settings/index.js` owns DOM lookup, page startup, event binding, and
top-level status/error handling. It instantiates the editor, persistence, and
transfer interfaces, registers the storage listener synchronously, and then
starts settings loading. Leaf modules must not register UI or Chrome listeners
as import-time side effects.

`src/settings/editor.js` owns custom-bundle editor state, selection,
structured edits, JSON synchronization, add/remove/undo behavior, and editor
rendering.

`src/settings/persistence.js` owns settings load/save/discard/default behavior,
UI snapshots, dirty-state decisions, ignored-host baseline/conflict handling,
and the atomic final conflict check/write under the existing lock.

`src/settings/transfer.js` owns backup export, file import, backup format/version
checks, validation-before-write, and post-import reload behavior.

`src/settings/validation.js` owns the existing pure parsing, normalization,
import validation, group coercion, and persistence-payload helpers currently in
`settings-validation.js`. Existing public behavior remains unchanged.

The split must not duplicate the custom-group state or ignored-host conflict
state across modules. `editor.js` owns editor state; `persistence.js` consumes
the editor through explicit operations and snapshots.

`src/ui/base.css` is a low-churn relocation of the entire current `style.css`,
including the settings- and popup-specific rules it already contains. Splitting
those rules into additional feature stylesheets is intentionally deferred so
CSS movement can be verified separately from selector ownership changes.

`src/ui/theme.js` remains a classic synchronous script loaded before stylesheet
links in both HTML documents. Do not convert it to an ES module; its early
execution preserves flash-free theme application.

## Manifest and Extension Paths

The final manifest uses these exact paths:

- Background worker: `src/background/index.js`
- Default popup: `src/popup/popup.html`
- Options page: `src/settings/settings.html`
- Icons: `assets/icons/16.png`, `assets/icons/48.png`, and
  `assets/icons/128.png` in both icon maps

Keep `background.type` equal to `module`. Do not change permissions,
host permissions, description, name, or manifest version other than the
approved patch increment.

Old direct extension URLs such as `/popup.html` and `/settings.html` are not
preserved. Normal popup and options navigation remains driven by the manifest.

## Migration Strategy

Every task must leave the branch internally coherent and reviewable.

1. Establish the clean test baseline and add characterization/path-integrity
   support.
2. Move core and shared UI modules first. Temporary root re-export shims are
   allowed only while active root entry points still require them.
3. Split and cut over the background worker, then remove the old worker.
4. Split and cut over the popup, then remove obsolete popup root files.
5. Split and cut over settings, then remove obsolete settings root files.
6. Move icons/branding, remove every temporary shim, update documentation, and
   enforce the final layout.

Do not retain duplicate active implementations. Temporary compatibility files
must be simple re-exports or path bridges and must be removed before final
verification.

## Automated Verification Design

### Existing behavioral suites

The existing Vitest grouping and settings-validation tests remain behavioral
characterization coverage and must continue passing after relevant tasks.

The existing Playwright suite remains the browser-integration gate. Its path
strings should be centralized in `tests/e2e/fixtures.js` as:

```js
export const backgroundPath = "src/background/index.js";
export const settingsPath = "src/settings/settings.html";
export const popupPath = "src/popup/popup.html";
```

Keep `repoRoot` and Chromium's `--load-extension` paths unchanged.

### URL helper tests

Add pure tests demonstrating that the shared URL helper:

- Parses valid HTTP and HTTPS URLs.
- Rejects malformed input without throwing.
- Treats only HTTP and HTTPS as eligible.
- Rejects `chrome:`, `edge:`, `file:`, `about:`, `chrome-extension:`, `data:`,
  and other non-HTTP(S) protocols.

Observe the new test failing for the expected missing-module/API reason before
implementing the shared helper.

### Extension layout integrity test

Add `tests/unit/extension-layout.test.js` using only Node built-ins. It must:

1. Parse `manifest.json` and assert the exact approved entry/icon paths.
2. Resolve each manifest path, reject root escape, and assert the file exists.
3. Read the manifest-selected popup and options HTML files and resolve all
   quoted local script and stylesheet paths relative to each page.
4. Recursively scan `src/**/*.js` for quoted static imports and re-exports,
   require shipped-source specifiers to be local, reject root escape, and
   assert resolved files exist.
5. Scan literal `chrome.runtime.getURL("...")` paths relative to the extension
   root, including `src/popup/window-actions.css`.
6. Scan local CSS imports/URLs while ignoring data URLs and fragment-only or
   non-file values.
7. Assert all approved final-layout files exist.
8. Assert the obsolete root runtime files and `icons/` directory are absent.

Regex extraction is proportionate to this repository's simple quoted static
references. The test must document that computed imports, computed `getURL`
arguments, generated HTML, and future novel manifest fields are outside its
automatic coverage.

Write the final-layout assertions before the final cutover and observe them
fail because the obsolete layout still exists; complete the cutover to make
them pass. Temporary compatibility shims are permitted before that cutover and
are therefore not prohibited by an earlier intermediate assertion.

### Commands

Run the relevant targeted suite after each task and the full suite at the final
gate. Final verification includes:

```sh
git diff --check
node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8'))"
find src tests -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:run
npm run test:e2e
```

The implementation environment's initial browser baseline was blocked because
the Playwright Chromium download repeatedly timed out or returned a truncated
archive and no system Chromium was available. Retry installation before final
verification. If it remains unavailable, do not claim the E2E suite passed:
publish the exact blocker and require a browser-capable Codex/CI or local run
before merge.

## Manual Verification

Automated tests do not replace the `AGENTS.md` manual requirements. Before
merge, manually verify in a supported Chromium browser:

- Loading the repository root as an unpacked extension.
- Background worker startup with no console errors.
- Real toolbar popup and browser options-page navigation.
- Light, dark, and system themes; layout, wrapping, focus, and keyboard use.
- Settings save, discard, defaults, import/export, reload, and unsaved changes.
- Popup/settings ignored-host conflict and concurrency behavior.
- Two-tab grouping, singleton behavior, cross-window isolation, protected user
  groups, strict membership, collapse behavior, and active-tab preservation.
- Pinned tabs remain entirely untouched.
- Non-HTTP(S) protocols remain ignored.
- Custom suffix, exact-host, domain-wide, host bundle, path bundle, and
  precedence behavior.
- Existing synchronized settings and unknown keys survive; appearance remains
  the only device-local preference.

## Subagent Execution and Review

Use a fresh implementer subagent for each implementation task. Implementation
tasks are serialized because they share manifest, entry-point, HTML, CSS, and
import state. Each implementer must run relevant tests, commit its task, and
write a self-review report.

After every task, a separate reviewer must receive the task brief, report, and
exact commit-range diff and return both a specification-compliance verdict and
a code-quality verdict. Important findings are fixed and re-reviewed before
the next implementation task.

After all tasks, dispatch a fresh whole-branch reviewer against the complete
base-to-head diff. Final verification results, review findings, residual manual
checks, risk level, version rationale, and coverage uncertainty must appear in
the pull-request description.

## Completion Criteria

The refactor is complete only when:

- The final layout matches this specification.
- No obsolete root runtime file or temporary shim remains.
- Every manifest, HTML, JavaScript, CSS, test, and README path is current.
- All available automated verification passes with fresh evidence, or an
  unavailable browser gate is explicitly reported as blocking merge confidence.
- A whole-branch reviewer finds no unresolved critical or important issue.
- The required real-browser manual checklist remains clearly handed off unless
  the user confirms it was performed.
