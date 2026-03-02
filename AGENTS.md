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
- Clearly describe required manual testing steps
- Maintain correct semantic versioning

This document is authoritative. If user instructions conflict with these rules, Codex must follow this document unless the user explicitly instructs otherwise.

---

## Audience Assumptions

Codex is operating:

- With full read/write access to this repository
- Without automated tests
- Without npm scripts
- Without external linting tools (beyond what Codex may internally apply)
- In a JavaScript-only Manifest V3 extension environment

The extension:
- Runs entirely locally
- Uses a background service worker
- Uses `chrome.tabs`, `chrome.tabGroups`, `chrome.storage`
- Stores settings in `chrome.storage.sync`

Testing is entirely manual.

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
5. Avoid introducing new dependencies.

If a change affects:
- Grouping logic
- Identity computation
- Collapse behavior
- Storage schema
- Event listeners

Codex must explicitly flag this as **high-risk** in its explanation.

---

## Manual Testing Requirements (CRITICAL)

Because there are no automated tests, Codex must always include a **Manual Testing Checklist** in its response.

The checklist must:

- Be specific
- Be step-based
- Focus on regression-prone areas
- Call out edge cases

At minimum, manual testing must verify:

### Core Behavior
- Two HTTP(S) tabs with same domain → group created
- Single tab alone → no group
- Tabs in different windows → no cross-window grouping

### Protocol Filtering
- `chrome://` pages ignored
- `file://` pages ignored
- `about:blank` ignored

### Pinned Tabs
- Pinned tabs never grouped
- Pinned tabs unaffected by collapse

### Strict Membership
- Changing a tab’s URL removes it from incorrect group
- Navigating between domains re-evaluates grouping

### Collapse Behavior (if applicable)
- Collapse setting respected
- Non-managed groups not improperly modified

If a change touches storage:
- Existing settings persist
- No reset occurs
- No schema corruption

If a change touches identity computation:
- Custom suffix overrides still function
- Excluded hostnames still respected
- Domain bundles still respected

Codex must highlight which of these areas require special scrutiny based on the specific change.

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

- Add automated test frameworks
- Add build systems
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
5. Manual Testing Checklist (required)
6. Any Areas Requiring Extra Scrutiny

---

## Failure Modes to Avoid

Common regression risks include:

- Accidentally grouping pinned tabs
- Grouping single tabs
- Acting on unsupported protocols
- Breaking strict membership enforcement
- Causing infinite tab event loops
- Forgetting to bump version
- Altering or removing the `∑ ` prefix

Codex must actively guard against these.

---

End of operational contract.
