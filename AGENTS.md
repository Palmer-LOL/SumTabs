# AGENTS.md — Operational Contract for Codex

## Title
Codex Operating Contract for SumTabs (Manifest V3 Chromium Extension)

---

## Objective

Define how Codex must operate when modifying this repository.

Codex’s role is to:
- Implement user-requested changes
- Preserve core behavioral invariants
- Minimize unintended regressions
- Run and accurately report relevant automated tests when they exist
- Clearly describe required manual testing steps
- State when automated coverage is absent, incomplete, not run, or uncertain
- Maintain correct semantic versioning

This document is authoritative. If user instructions conflict with these rules, Codex must follow this document unless the user explicitly instructs otherwise.

---

## Audience Assumptions

Codex is operating:

- With full read/write access to this repository
- In a JavaScript-only Manifest V3 extension environment
- With automated testing infrastructure that may be absent, partial, or actively evolving
- Without assuming that a test command, test framework, browser harness, linter, or build system exists unless it is present in the checked-out repository

The extension:
- Runs entirely locally
- Uses a background service worker
- Uses `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`
- Stores functional settings in `chrome.storage.sync`, except for the documented appearance-preference exception

Before making or validating a change, Codex must inspect the repository for the testing capabilities that actually exist at that time, including as applicable:

- `package.json` scripts
- Test configuration files
- Test directories and fixtures
- GitHub Actions workflows
- Repository documentation describing test scope

Codex must never claim that a scenario is covered by automation merely because a test framework is installed or a broadly named test suite passes. Coverage exists only when a relevant test explicitly exercises the behavior in question.

---

## Core Invariants (MUST NEVER BE VIOLATED)

### 1. Managed Group Prefix (Immutable)

The managed group prefix MUST remain exactly: `∑ `

Including:
- The Unicode summation symbol
- The trailing space

Codex must:
- Never change this prefix
- Never parameterize it
- Never migrate it
- Never expose it as editable
- Never infer alternate prefixes

All managed group detection must rely strictly on this prefix.

---

### 2. URL Scope Restrictions

The extension must ONLY interact with:

- `http://`
- `https://`

Codex must:
- Ignore all other protocols
- Never attempt to group:
  - `chrome://`
  - `edge://`
  - `file://`
  - `about:`
  - `chrome-extension://`
  - `data:`
  - or any non-HTTP(S) URL

If modifying URL handling logic, Codex must ensure this invariant remains strictly enforced.

---

### 3. Pinned Tabs Are Untouchable

Pinned tabs must never be:

- Moved into a group
- Removed from a group
- Collapsed due to group operations
- Modified in any way by grouping logic

All grouping logic must explicitly guard against `tab.pinned === true`.

This is non-negotiable.

---

### 4. Group Formation Rules

Codex must preserve these behaviors unless explicitly instructed otherwise:

- Groups form only when **two or more matching tabs exist in the same window**
- Group identity is derived from hostname registrable domain (including custom suffix handling and bundles)
- Strict membership enforcement:
  - Tabs that no longer match must be removed from managed groups
- Optional collapse behavior must respect user settings

Codex must not weaken:
- Identity matching rules
- Membership enforcement rules
- Window scoping rules

---

### 5. Local-Only Operation

The extension must:

- Perform all logic locally
- Never introduce network calls
- Never add analytics
- Never add telemetry
- Never add remote configuration
- Never introduce external services

---

## Versioning Requirements (MANDATORY)

Every change MUST update the version in `manifest.json`.

Use semantic versioning:

### Patch — `0.0.X`
Use for:
- Bug fixes
- Refactors with no functional change
- Minor internal improvements
- Documentation, testing, and developer-workflow changes that do not alter extension behavior

### Minor — `0.X.0`
Use for:
- Small new features
- Settings additions
- User-visible behavior changes (non-breaking)

### Major — `X.0.0`
Use only for:
- Large architectural changes
- Breaking behavior changes
- Substantial grouping logic overhaul

Codex must:
- Determine the correct increment type
- Update the version in `manifest.json`
- Clearly state in its response why the chosen increment was appropriate

Failure to update the version is a violation of this contract.

---

## Modification Workflow Requirements

When making changes, Codex must:

1. Identify all affected files.
2. Keep changes minimal and localized.
3. Avoid unnecessary refactors.
4. Preserve existing structure unless explicitly instructed.
5. Avoid introducing new dependencies unless the requested work requires them.
6. Inspect the current automated-testing capabilities before deciding how the change can be validated.
7. Run the relevant available automated tests when practical.
8. Define the manual verification still required after automation.

If a change affects:
- Grouping logic
- Identity computation
- Collapse behavior
- Storage schema
- Event listeners

Codex must explicitly flag this as **high-risk** in its explanation.

---

## Automated Testing Roadmap and Transitional Rules

Automated testing is an intentional roadmap item for SumTabs. The repository may move gradually from entirely manual verification to a mixture of unit, integration, browser, accessibility, and end-to-end tests.

During this transition, Codex must treat the available automated test suite as evolving and potentially incomplete.

### When Automated Tests Exist

Codex must:

- Run the tests relevant to the changed behavior when the environment permits.
- Report the exact commands run and whether they passed, failed, or could not be executed.
- Identify which changed behaviors the tests actually exercise.
- Preserve existing tests and fixtures unless a deliberate change is required.
- Never delete, skip, weaken, or rewrite a meaningful assertion solely to make a change pass.
- Add or update a regression test for a bug fix when a suitable test harness already exists and doing so is proportionate to the change.

A passing test suite does not remove the manual-testing requirements below.

### When Automated Tests Do Not Exist or Are Incomplete

Codex must:

- Continue with the requested implementation unless the user specifically requires test infrastructure first.
- Provide specific manual testing steps for the uncovered behavior.
- Identify useful future automated-test candidates when relevant.
- Avoid claiming coverage for neighboring or similar behavior that is not explicitly tested.

### When Coverage Is Uncertain

If Codex cannot confidently determine whether a changed behavior is covered by the current tests, it must:

1. State that automated coverage is **uncertain**.
2. Explain what was inspected and why coverage could not be confirmed.
3. Include the scenario in the manual testing checklist.
4. Avoid treating a general test-suite pass as proof that the scenario works.

Uncertainty must be disclosed; it must not be silently resolved through assumption.

### Introducing or Expanding Test Infrastructure

Adding an automated test framework, test dependencies, npm scripts, fixtures, browser automation, or CI workflows is permitted when:

- The user explicitly requests testing work; or
- The agreed implementation plan includes that testing work.

Codex must keep test infrastructure separate from the shipped extension wherever practical. Development-only tooling must not introduce runtime network calls, telemetry, remote code, or unnecessary production dependencies.

Adding test tooling does not automatically authorize a production build system, TypeScript migration, bundler, or broad architectural rewrite.

---

## Manual Testing Requirements (CRITICAL)

Manual testing remains required because automated coverage may be partial and because some Chromium-extension behavior, visual presentation, accessibility, browser integration, and human usability cannot be established solely by unit tests.

Every implementation response must include a **Manual Testing Checklist**, except for changes that affect documentation only. For documentation-only changes, Codex must instead state that no extension runtime behavior changed and describe the documentation review performed.

The manual checklist must:

- Be specific and step-based.
- Focus on the behavior changed and the regression-prone areas it could affect.
- Distinguish between tests already covered by automation and checks that still require human verification.
- Include any behavior whose automated coverage is uncertain.
- Call out edge cases and browser-specific behavior.
- Avoid asserting that the user performed the checklist unless the user actually reports doing so.

### Always Test by Hand When Applicable

The following require manual verification when affected by the change, even if some automated coverage exists:

- User-visible layout, visual hierarchy, text wrapping, themes, focus indicators, and responsive behavior
- Keyboard navigation and practical accessibility behavior
- Screen-reader announcements and interaction flow when accessibility semantics change
- Browser-extension popup and settings behavior in a real supported Chromium browser
- Permission prompts or manifest changes
- Destructive actions and confirmation language
- Behavior involving user-created tab groups
- Any browser-specific behavior not exercised by the available automated browser suite
- Any scenario for which automated coverage is uncertain

### Core Behavior Regression Checks

For changes touching grouping, event handling, tabs, windows, or enforcement, manually verify as applicable:

- Two HTTP(S) tabs with the same grouping identity → managed group created
- Single tab alone → no managed group created
- Tabs in different windows → no cross-window grouping
- User-created groups remain unmanaged and are not reorganized by SumTabs

### Protocol Filtering

For changes touching URL parsing, tab eligibility, or event handling, manually verify as applicable:

- `chrome://` pages ignored
- `file://` pages ignored
- `about:blank` ignored
- Other non-HTTP(S) URLs ignored

### Pinned Tabs

For changes touching grouping, movement, collapse, cleanup, or tab lifecycle behavior, manually verify:

- Pinned tabs are never grouped or moved by SumTabs
- Pinned tabs are not removed from groups by SumTabs
- Pinned tabs are unaffected by collapse behavior

### Strict Membership

For changes touching navigation or group enforcement, manually verify:

- Changing a tab’s URL removes it from an incorrect managed group
- Navigating between domains re-evaluates grouping
- Tabs in user-created groups are not commandeered during navigation

### Collapse Behavior

For changes touching group focus or collapse behavior, manually verify:

- The collapse setting is respected
- Non-managed groups are not improperly modified
- Pinned tabs are not affected

### Storage and Settings

For changes touching storage, settings, defaults, migration, or UI persistence, manually verify:

- Existing settings persist
- No unexpected reset occurs
- No schema corruption occurs
- Save, cancel, reset, and unsaved-change behavior remain correct where applicable
- Appearance storage continues to obey the narrow local-storage exception

### Identity Computation

For changes touching domain identity or precedence, manually verify as applicable:

- Custom suffix overrides still function
- Exact-host separation rules still function
- Domain-wide separation rules still function
- Custom bundles still function
- Path-scoped bundle rules and precedence still function

Codex must highlight which manual areas require special scrutiny for the specific change. It must not mechanically include unrelated steps merely to make the checklist appear complete.

---

## Storage Schema Rules

Settings are stored in `chrome.storage.sync`.

Codex must:

- Avoid unnecessary schema changes
- Preserve backward compatibility
- Avoid deleting unknown keys
- Avoid renaming keys without migration logic

If a schema change is required:
- Codex must implement safe default handling
- Codex must describe migration behavior explicitly
- Codex must flag manual verification steps

### Appearance Preference Exception (Intentional)

The SumTabs appearance preference is explicitly exempt from the general `chrome.storage.sync` requirement.

The single key `sumtabs.themePreference` MAY be stored in extension-origin `localStorage`, subject to all of the following constraints:

- The effective preference may be only `system`, `light`, or `dark`; the implementation may represent `system` by removing the key entirely.
- It controls presentation only and must never affect tab grouping, enforcement, domain rules, bundles, permissions, or other extension behavior.
- No other setting or user data may be moved to `localStorage` under this exception.
- All functional and grouping-related settings must continue to use `chrome.storage.sync`.

This exception is intentional because appearance is device-local UI state that should not be synchronized across computers, and synchronous `localStorage` access allows the theme to be applied before styles render, avoiding a visible light-theme flash on extension pages. Codex and automated reviewers must treat this narrowly scoped use of `localStorage` as contract-compliant.

---

## Manifest and Permission Rules

Codex must not:

- Expand host permissions without strong justification
- Add new permissions unless absolutely required
- Modify background type (must remain MV3 service worker)

Any permission change must be explicitly justified in the response.

---

## Non-Goals

Codex must not:

- Add a production build system merely because test tooling is introduced
- Introduce TypeScript
- Perform broad stylistic rewrites
- Change the managed prefix
- Introduce cross-window grouping
- Introduce support for non-HTTP(S) URLs
- Modify pinned tab behavior

Unless explicitly instructed by the user.

---

## Required Response Structure When Making Changes

When Codex completes a modification, it must include:

1. Summary of Change
2. Risk Level (Low / Medium / High)
3. Version Increment Justification
4. Files Modified
5. Automated Tests
   - Commands run and results
   - Behaviors explicitly covered
   - Tests not run or unavailable
   - Coverage uncertainties
6. Manual Testing Checklist, or documentation review for documentation-only changes
7. Any Areas Requiring Extra Scrutiny

Codex must not use “all tests passed” as a substitute for identifying what those tests cover.

---

## Failure Modes to Avoid

Common regression and process risks include:

- Accidentally grouping pinned tabs
- Grouping single tabs
- Acting on unsupported protocols
- Breaking strict membership enforcement
- Modifying user-created groups
- Causing infinite tab event loops
- Forgetting to bump version
- Altering or removing the `∑ ` prefix
- Claiming automated coverage without locating a relevant test
- Omitting manual checks because a general test suite passed
- Hiding uncertainty about whether a scenario is tested
- Weakening tests to accommodate an incorrect implementation

Codex must actively guard against these.

---

End of operational contract.
