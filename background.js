// Auto-group tabs by root/registrable domain (with domain-wide + exact-host separation rules) + strict membership enforcement.
// SAFETY VERSION: adds throttles + re-entrancy guards to prevent event storms / runaway loops.
import { DEFAULTS } from "./defaults.js";
import { buildCustomBundleMaps, resolveGroupingForHostname } from "./grouping.js";

// -------------------- SETTINGS --------------------

let settings = structuredClone(DEFAULTS);

// Derived runtime structures
let COMMON_MULTIPART_SUFFIXES = new Set(DEFAULTS.commonMultipartSuffixes);
let EXCLUDED_FROM_ROOT_COLLAPSE = new Set(DEFAULTS.excludedFromRootCollapse);
let IGNORED_HOSTNAMES = new Set(DEFAULTS.ignoredHostnames);
let AUTO_GROUP_PREFIX = DEFAULTS.autoGroupPrefix;
let MIN_TABS_TO_GROUP = DEFAULTS.minTabsToGroup;
let COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS = DEFAULTS.collapseOtherGroupsOnNavEvents;
let KEEP_MANAGED_GROUPS_AT_FRONT = DEFAULTS.keepManagedGroupsAtFront;
let UNGROUP_SINGLETON_MANAGED_GROUPS = DEFAULTS.ungroupSingletonManagedGroups;
let IGNORE_INITIAL_TAB_URL = DEFAULTS.ignoreInitialTabUrlForGrouping
    && DEFAULTS.ignoreInitialTabUrlForEnforcement;

let customBundleMaps = {
    exactHostnameToBundleRules: new Map(),
    rootDomainToBundleRules: new Map(),
};
let customIdentityToColor = new Map();
const VALID_GROUP_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function rebuildDerived() {
    AUTO_GROUP_PREFIX = settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix;
    const rawMinTabsToGroup = Number(settings.minTabsToGroup);
    MIN_TABS_TO_GROUP = Number.isFinite(rawMinTabsToGroup)
        ? Math.max(2, Math.floor(rawMinTabsToGroup))
        : DEFAULTS.minTabsToGroup;
    COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS = !!settings.collapseOtherGroupsOnNavEvents;
    KEEP_MANAGED_GROUPS_AT_FRONT = !!settings.keepManagedGroupsAtFront;
    UNGROUP_SINGLETON_MANAGED_GROUPS = !!settings.ungroupSingletonManagedGroups;
    // These legacy storage keys now represent one setting. Treat a historical
    // mismatch as disabled so grouping and enforcement can never diverge.
    IGNORE_INITIAL_TAB_URL = !!settings.ignoreInitialTabUrlForGrouping
        && !!settings.ignoreInitialTabUrlForEnforcement;

    COMMON_MULTIPART_SUFFIXES = new Set((settings.commonMultipartSuffixes ?? []).map(s => String(s).toLowerCase()));
    EXCLUDED_FROM_ROOT_COLLAPSE = new Set((settings.excludedFromRootCollapse ?? []).map(s => String(s).toLowerCase()));
    IGNORED_HOSTNAMES = new Set((settings.ignoredHostnames ?? []).map(s => String(s).trim().toLowerCase()).filter(Boolean));

    customBundleMaps = buildCustomBundleMaps(settings.customDomainGroups);
    customIdentityToColor = new Map();
    for (const g of (settings.customDomainGroups ?? [])) {
        if (!g?.title || !Array.isArray(g.domains)) continue;

        const title = String(g.title).trim();
        if (!title) continue;

        const ident = AUTO_GROUP_PREFIX + title;
        const color = String(g?.color ?? "").trim().toLowerCase();
        if (VALID_GROUP_COLORS.has(color)) customIdentityToColor.set(ident, color);
    }
}

async function loadSettings() {
    settings = await chrome.storage.sync.get(DEFAULTS);
    rebuildDerived();
}

chrome.runtime.onStartup?.addListener(async () => {
    await loadSettings();
});

chrome.runtime.onInstalled?.addListener(async () => {
    await loadSettings();
});

// Live-update if user changes options
let reevaluationQueue = Promise.resolve();
let ignoredHostnameUpdateQueue = Promise.resolve();
const ignoredHostnameChangeWaiters = [];
const IGNORED_HOSTNAMES_STORAGE_LOCK = "sumtabs:ignored-hostnames-storage";

function enqueueForceReevaluation() {
    const reevaluation = reevaluationQueue
        .catch(() => {})
        .then(() => forceReevaluateAllWindows());
    reevaluationQueue = reevaluation;
    return reevaluation;
}

function ignoredHostnamesSignature(values) {
    return JSON.stringify(
        [...new Set((values ?? [])
            .map(value => String(value).trim().toLowerCase())
            .filter(Boolean))]
            .sort(),
    );
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    rebuildDerived();

    if (changes.keepManagedGroupsAtFront?.newValue || changes.ignoredHostnames) {
        const reevaluation = enqueueForceReevaluation();

        if (changes.ignoredHostnames) {
            const signature = ignoredHostnamesSignature(changes.ignoredHostnames.newValue);
            const matchingWaiters = ignoredHostnameChangeWaiters
                .filter(waiter => waiter.signature === signature);
            for (const waiter of matchingWaiters) {
                ignoredHostnameChangeWaiters.splice(ignoredHostnameChangeWaiters.indexOf(waiter), 1);
                reevaluation.then(waiter.resolve, waiter.reject);
            }
        }

        // Storage changes without a popup awaiting completion still need error
        // isolation so the service worker does not produce an unhandled rejection.
        reevaluation.catch(() => {});
    }
});

let settingsReady = loadSettings();

// -------------------- SAFETY RAILS --------------------

// Per-tab debounce: do not process same tab more often than this.
const TAB_DEBOUNCE_MS = 750;

// Global re-entrancy lock for mutations we cause (group/ungroup/tabGroups.update).
// We keep it short and best-effort.
let mutationLockUntil = 0;

// Per-tab last processed timestamp
const lastProcessedAt = new Map(); // tabId -> ms

function nowMs() { return Date.now(); }

function underMutationLock() {
    return nowMs() < mutationLockUntil;
}

function acquireMutationLock(ms = 250) {
    // Extend lock slightly into the future.
    mutationLockUntil = Math.max(mutationLockUntil, nowMs() + ms);
}

function shouldProcessTab(tabId) {
    const t = nowMs();
    const last = lastProcessedAt.get(tabId) || 0;
    if (t - last < TAB_DEBOUNCE_MS) return false;
    lastProcessedAt.set(tabId, t);
    return true;
}

setInterval(() => {
    const cutoff = nowMs() - 10 * 60 * 1000;
    for (const [tabId, t] of lastProcessedAt.entries()) {
        if (t < cutoff) {
            lastProcessedAt.delete(tabId);
            lastSeenUrlByTab.delete(tabId);
            initialUrlByTab.delete(tabId);
        }
    }
}, 5 * 60 * 1000);

// -------------------- UTIL --------------------

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;
const GROUP_OWNERSHIP_UNGROUPED = "ungrouped";
const GROUP_OWNERSHIP_MANAGED = "managed";
const GROUP_OWNERSHIP_PROTECTED = "protected";

const lastActiveGroupByWindow = new Map();
const groupTitleCache = new Map(); // groupId -> title
const lastSeenUrlByTab = new Map(); // tabId -> last seen tab.url
const initialUrlByTab = new Map(); // tabId -> first seen http(s) URL


function safeParseUrl(urlString) {
    try { return new URL(urlString); } catch { return null; }
}
function isWebUrl(u) {
    return u && (u.protocol === "http:" || u.protocol === "https:");
}
function getParsedUrlFromTab(tab, changeInfo) {
    const url = (changeInfo && changeInfo.url) || tab?.url || tab?.pendingUrl;
    const u = safeParseUrl(url);
    if (!isWebUrl(u)) return null;
    return u;
}

function isManagedGroupTitle(title) {
    return !!title && title.startsWith(AUTO_GROUP_PREFIX);
}

function getGroupingForUrl(parsedUrl) {
    // Shared precedence lives in grouping.js: exact custom bundles first, then inherited root-domain bundles, then default separation rules.
    return resolveGroupingForHostname({
        url: parsedUrl.href,
        hostname: parsedUrl.hostname,
        pathname: parsedUrl.pathname,
        commonMultipartSuffixes: COMMON_MULTIPART_SUFFIXES,
        excludedFromRootCollapse: EXCLUDED_FROM_ROOT_COLLAPSE,
        ignoredHostnames: IGNORED_HOSTNAMES,
        customBundleMaps,
        managedPrefix: AUTO_GROUP_PREFIX,
    });
}

function resolveTabGrouping(tab, changeInfo) {
    if (!tab || tab.pinned) return null;

    const parsedUrl = getParsedUrlFromTab(tab, changeInfo);
    if (!parsedUrl) return null;

    return getGroupingForUrl(parsedUrl);
}

async function withSettings(fn) {
    await settingsReady;
    return fn();
}

async function getGroupTitle(groupId, { fresh = false } = {}) {
    if (groupId == null || groupId === NONE) return null;
    if (!fresh && groupTitleCache.has(groupId)) return groupTitleCache.get(groupId);

    try {
        const g = await chrome.tabGroups.get(groupId);
        const title = g?.title ?? null;
        groupTitleCache.set(groupId, title);
        return title;
    } catch {
        groupTitleCache.delete(groupId);
        return null;
    }
}

async function classifyGroupOwnership(groupId, { fresh = false } = {}) {
    if (groupId == null || groupId === NONE) return GROUP_OWNERSHIP_UNGROUPED;

    const title = await getGroupTitle(groupId, { fresh });
    return isManagedGroupTitle(title)
        ? GROUP_OWNERSHIP_MANAGED
        : GROUP_OWNERSHIP_PROTECTED;
}

async function classifyTabGroup(tab, options) {
    return classifyGroupOwnership(tab?.groupId, options);
}

async function ensureGroupTitle(groupId, title) {
    if (groupId == null || groupId === NONE) return false;

    try {
        const currentTitle = await getGroupTitle(groupId);
        if (currentTitle === title) return false;

        acquireMutationLock(250);
        await chrome.tabGroups.update(groupId, { title });
        groupTitleCache.set(groupId, title);
        return true;
    } catch {
        return false;
    }
}

async function ensureGroupColor(groupId, color) {
    if (groupId == null || groupId === NONE) return false;
    if (!VALID_GROUP_COLORS.has(color)) return false;

    try {
        const group = await chrome.tabGroups.get(groupId);
        if (!isManagedGroupTitle(group?.title)) return false;
        groupTitleCache.set(groupId, group.title);
        if (group?.color === color) return false;

        acquireMutationLock(250);
        await chrome.tabGroups.update(groupId, { color });
        return true;
    } catch {
        return false;
    }
}

async function setGroupCollapsed(groupId, collapsed) {
    if (await classifyGroupOwnership(groupId, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) return false;

    try {
        acquireMutationLock(250);
        await chrome.tabGroups.update(groupId, { collapsed });
        return true;
    } catch {
        return false;
    }
}

async function expandGroupIfCollapsed(groupId) {
    if (await classifyGroupOwnership(groupId, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) return;

    try {
        const group = await chrome.tabGroups.get(groupId);
        if (!group?.collapsed) return;
        await setGroupCollapsed(groupId, false);
    } catch {}
}

async function runChromiumGroupTitleRenderWorkaround(windowId, originalActiveTabId = null) {
    if (windowId == null) return;

    let blankTabId = null;

    try {
        const [activeTab] = originalActiveTabId == null
            ? await chrome.tabs.query({ windowId, active: true })
            : [await chrome.tabs.get(originalActiveTabId)];
        if (!activeTab?.id || activeTab.windowId !== windowId) return;

        const collapseStateByGroup = new Map();

        const blankTab = await chrome.tabs.create({ windowId, url: "about:blank", active: false });
        if (!blankTab?.id) return;

        blankTabId = blankTab.id;

        await chrome.tabs.update(blankTabId, { active: true });

        const tabs = await chrome.tabs.query({ windowId });
        const groupIds = new Set();

        for (const t of tabs) {
            if (t.groupId != null && t.groupId !== NONE) groupIds.add(t.groupId);
        }

        for (const gid of groupIds) {
            try {
                const group = await chrome.tabGroups.get(gid);
                if (!isManagedGroupTitle(group?.title)) continue;
                groupTitleCache.set(gid, group.title);
                collapseStateByGroup.set(gid, !!group?.collapsed);
            } catch {}
        }

        for (const gid of collapseStateByGroup.keys()) {
            await setGroupCollapsed(gid, true);
        }

        await chrome.tabs.update(activeTab.id, { active: true });

        for (const [gid, wasCollapsed] of collapseStateByGroup.entries()) {
            await setGroupCollapsed(gid, wasCollapsed);
        }
    } catch {
    } finally {
        if (blankTabId != null) {
            try {
                await chrome.tabs.remove(blankTabId);
            } catch {}
        }
    }
}

async function ungroupManagedTab(tabId, expectedGroupId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || tab.pinned || tab.groupId !== expectedGroupId) return false;
        if (await classifyGroupOwnership(expectedGroupId, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) return false;

        acquireMutationLock(250);
        await chrome.tabs.ungroup(tabId);
        return true;
    } catch {
        return false;
    }
}

// Returns eligible tabs in the window whose CURRENT identity matches groupIdentity.
// Excludes pinned tabs, non-http(s), and tabs inside user-created groups.
async function getEligibleMatchingTabs(windowId, groupIdentity) {
    const tabs = await chrome.tabs.query({ windowId });
    const matches = [];

    for (const t of tabs) {
        const grouping = resolveTabGrouping(t);
        if (grouping?.identity !== groupIdentity) continue;

        const ownership = await classifyTabGroup(t);
        if (ownership === GROUP_OWNERSHIP_PROTECTED) continue;

        matches.push(t);
    }
    return matches;
}

async function revalidateEligibleMatchingTabs(candidates, windowId, groupIdentity) {
    const matches = [];

    for (const candidate of candidates) {
        if (candidate?.id == null) continue;

        try {
            const current = await chrome.tabs.get(candidate.id);
            if (!current || current.pinned || current.windowId !== windowId) continue;

            const grouping = resolveTabGrouping(current);
            if (grouping?.identity !== groupIdentity) continue;

            const ownership = await classifyTabGroup(current, { fresh: true });
            if (ownership === GROUP_OWNERSHIP_PROTECTED) continue;

            matches.push(current);
        } catch {}
    }

    return matches;
}

// Find group by identity, but only if group title exactly equals identity.
async function findExistingGroupIdForIdentity(matches, groupIdentity, { fresh = false } = {}) {
    for (const t of matches) {
        const gid = t.groupId;
        if (gid == null || gid === NONE) continue;

        const title = await getGroupTitle(gid, { fresh });
        if (title === groupIdentity) return gid;
    }
    return null;
}

async function cleanupManagedSingletonGroupsInWindow(windowId) {
    if (windowId == null) return;

    // false/default => keep singleton grouped; true => ungroup singleton managed group.
    if (!UNGROUP_SINGLETON_MANAGED_GROUPS) return;

    try {
        const tabs = await chrome.tabs.query({ windowId });
        const tabsByGroupId = new Map();

        for (const t of tabs) {
            const gid = t?.groupId;
            if (gid == null || gid === NONE) continue;

            if (!tabsByGroupId.has(gid)) tabsByGroupId.set(gid, []);
            tabsByGroupId.get(gid).push(t);
        }

        for (const [gid, groupedTabs] of tabsByGroupId.entries()) {
            if (groupedTabs.length !== 1) continue;

            const title = await getGroupTitle(gid, { fresh: true });
            if (!isManagedGroupTitle(title)) continue;

            const [singletonTab] = groupedTabs;
            if (!singletonTab?.id || singletonTab.pinned) continue;

            await ungroupManagedTab(singletonTab.id, gid);
        }
    } catch {}
}

async function keepManagedGroupsAtFrontInWindow(windowId) {
    if (!KEEP_MANAGED_GROUPS_AT_FRONT || windowId == null) return;

    try {
        const tabs = await chrome.tabs.query({ windowId });
        const pinnedTabCount = tabs.filter(t => t?.pinned === true).length;
        const managedGroupsById = new Map();

        for (const tab of tabs) {
            const gid = tab?.groupId;
            if (gid == null || gid === NONE) continue;
            if (managedGroupsById.has(gid)) continue;

            const title = await getGroupTitle(gid);
            if (!isManagedGroupTitle(title)) continue;

            managedGroupsById.set(gid, {
                id: gid,
                firstIndex: Number.isFinite(tab.index) ? tab.index : Number.MAX_SAFE_INTEGER,
            });
        }

        const managedGroups = [...managedGroupsById.values()]
            .sort((a, b) => a.firstIndex - b.firstIndex);

        let targetIndex = pinnedTabCount;
        for (const group of managedGroups) {
            acquireMutationLock(350);
            await chrome.tabGroups.move(group.id, { index: targetIndex });

            const movedTabs = await chrome.tabs.query({ windowId, groupId: group.id });
            const groupWidth = movedTabs.filter(tab => tab?.pinned !== true).length;
            targetIndex += Math.max(1, groupWidth);
        }
    } catch {}
}

async function enforceGroupMembershipForTab(tab, currentGrouping) {
    if (!tab || tab.id == null) return;
    if (tab.pinned) return;

    // A missing identity (including an ignored hostname) must be enforced
    // immediately so ignore rules retain absolute precedence.
    if (IGNORE_INITIAL_TAB_URL && currentGrouping?.identity) {
        const initialUrl = initialUrlByTab.get(tab.id);
        const currentUrl = tab.url || tab.pendingUrl;
        if (initialUrl && currentUrl && currentUrl === initialUrl) return;
    }

    const gid = tab.groupId;
    if (gid == null || gid === NONE) return;

    const title = await getGroupTitle(gid, { fresh: true });

    // Only police groups created/managed by this extension. Unknown groups fail closed.
    if (!isManagedGroupTitle(title)) return;

    const currentIdentity = currentGrouping?.identity;

    // Ignored hostnames have no identity and must leave managed groups. Other
    // identity changes continue to receive strict membership enforcement.
    if (!currentIdentity || title !== currentIdentity) {
        await ungroupManagedTab(tab.id, gid);
    }
}

async function maybeGroupTab(tab, currentGrouping, originalActiveTabId = null) {
    if (!tab || tab.id == null || tab.windowId == null) return;
    if (tab.pinned) return;

    // User-created groups are protected. SumTabs only acts on ungrouped tabs or its own prefixed groups.
    if (await classifyTabGroup(tab, { fresh: true }) === GROUP_OWNERSHIP_PROTECTED) return;

    // Optional: ignore grouping while the tab is still on its initial URL
    if (IGNORE_INITIAL_TAB_URL) {
        const initialUrl = initialUrlByTab.get(tab.id);
        const currentUrl = tab.url || tab.pendingUrl;
        if (initialUrl && currentUrl && currentUrl === initialUrl) {
            // The initial-URL exemption must not preserve ignored hostnames in
            // managed groups, including tabs created directly inside a group.
            if (!currentGrouping?.identity) {
                await enforceGroupMembershipForTab(tab, currentGrouping);
            }
            return;
        }
    }

    const groupIdentity = currentGrouping?.identity;
    // Membership enforcement first
    await enforceGroupMembershipForTab(tab, currentGrouping);

    if (!groupIdentity) return;

    let matches = await getEligibleMatchingTabs(tab.windowId, groupIdentity);
    // Respect threshold for both creating new groups and attaching to existing managed groups.
    if (matches.length < MIN_TABS_TO_GROUP) return;

    // Re-fetch ownership and identity immediately before mutation to minimize races with user actions.
    matches = await revalidateEligibleMatchingTabs(matches, tab.windowId, groupIdentity);
    if (matches.length < MIN_TABS_TO_GROUP) return;
    if (!matches.some(t => t.id === tab.id)) return;

    const existingGroupId = await findExistingGroupIdForIdentity(matches, groupIdentity, { fresh: true });
    const desiredColor = customIdentityToColor.get(groupIdentity);

    if (existingGroupId != null) {
        const [currentTab] = await revalidateEligibleMatchingTabs([tab], tab.windowId, groupIdentity);
        if (!currentTab) return;
        if (await classifyGroupOwnership(existingGroupId, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) return;

        try {
            acquireMutationLock(300);
            await chrome.tabs.group({ tabIds: [tab.id], groupId: existingGroupId });
            await ensureGroupColor(existingGroupId, desiredColor);
            await expandGroupIfCollapsed(existingGroupId);
        } catch {}
        return;
    }

    // Revalidate once more before creating a group; the browser API has no atomic ownership precondition.
    matches = await revalidateEligibleMatchingTabs(matches, tab.windowId, groupIdentity);
    if (matches.length < MIN_TABS_TO_GROUP) return;
    if (!matches.some(t => t.id === tab.id)) return;

    // Create new group containing all currently eligible matching tabs.
    const tabIds = matches.map(t => t.id).filter(id => id != null);

    try {
        acquireMutationLock(350);
        const newGroupId = await chrome.tabs.group({ tabIds });
        await ensureGroupTitle(newGroupId, groupIdentity);
        await ensureGroupColor(newGroupId, desiredColor);
        await expandGroupIfCollapsed(newGroupId);
        await keepManagedGroupsAtFrontInWindow(tab.windowId);
        await runChromiumGroupTitleRenderWorkaround(tab.windowId, originalActiveTabId);
    } catch {}
}

async function handleActivation(tabId, windowId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;

    const prevGroupId = lastActiveGroupByWindow.get(windowId);
    const currGroupId = (tab.groupId != null ? tab.groupId : NONE);
    const currOwnership = await classifyGroupOwnership(currGroupId, { fresh: true });

    // Focus mode pauses while the user is working inside a user-created group,
    // but keep the previously active managed group tracked so it can still be
    // collapsed when focus later moves to another managed group.
    if (currOwnership === GROUP_OWNERSHIP_PROTECTED) return;

    lastActiveGroupByWindow.set(windowId, currGroupId);

    if (prevGroupId != null && prevGroupId !== NONE && prevGroupId !== currGroupId) {
        await setGroupCollapsed(prevGroupId, true);
    }
    if (currOwnership === GROUP_OWNERSHIP_MANAGED && currGroupId !== prevGroupId) {
        await setGroupCollapsed(currGroupId, false);
    }
}

async function collapseAllGroupsExcept(windowId, keepGroupId) {
    try {
        const keepOwnership = await classifyGroupOwnership(keepGroupId, { fresh: true });
        if (keepOwnership === GROUP_OWNERSHIP_PROTECTED) return;

        const tabs = await chrome.tabs.query({ windowId });
        const groupIds = new Set();

        for (const t of tabs) {
            if (t.groupId != null && t.groupId !== NONE) groupIds.add(t.groupId);
        }

        for (const gid of groupIds) {
            if (await classifyGroupOwnership(gid, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) continue;

            if (keepOwnership === GROUP_OWNERSHIP_MANAGED && gid === keepGroupId) {
                // Keep the active/target managed group expanded.
                await setGroupCollapsed(gid, false);
            } else {
                await setGroupCollapsed(gid, true);
            }
        }
    } catch {}
}



async function forceReevaluateAllWindows() {
    await settingsReady;

    const windows = await chrome.windows.getAll();

    for (const win of windows) {
        const windowId = win?.id;
        if (windowId == null) continue;

        const tabs = await chrome.tabs.query({ windowId });
        const originalActiveTabId = tabs.find(tab => tab.active)?.id ?? null;

        for (const tab of tabs) {
            if (!tab || tab.id == null || tab.pinned || tab.windowId == null) continue;

            const parsed = safeParseUrl(tab.url || tab.pendingUrl);
            if (!isWebUrl(parsed)) continue;

            const grouping = resolveTabGrouping(tab);
            await maybeGroupTab(tab, grouping, originalActiveTabId);
        }

        await cleanupManagedSingletonGroupsInWindow(windowId);

        const refreshedTabs = await chrome.tabs.query({ windowId });

        for (const tab of refreshedTabs) {
            if (!tab || tab.id == null || tab.pinned) continue;
            if (tab.groupId == null || tab.groupId === NONE) continue;

            const title = await getGroupTitle(tab.groupId, { fresh: true });
            if (!isManagedGroupTitle(title)) continue;

            const parsed = safeParseUrl(tab.url || tab.pendingUrl);
            if (!isWebUrl(parsed)) continue;

            const grouping = resolveTabGrouping(tab);
            await enforceGroupMembershipForTab(tab, grouping);
        }

        await keepManagedGroupsAtFrontInWindow(windowId);
        let restoredActiveTab = null;
        if (originalActiveTabId != null) {
            try {
                const originalActiveTab = await chrome.tabs.get(originalActiveTabId);
                if (originalActiveTab?.windowId === windowId) {
                    restoredActiveTab = await chrome.tabs.update(originalActiveTabId, { active: true });
                }
            } catch {}
        }

        if (COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS) {
            let activeTabForCollapse = restoredActiveTab;
            if (!activeTabForCollapse) {
                [activeTabForCollapse] = await chrome.tabs.query({ windowId, active: true });
            }
            await collapseAllGroupsExcept(windowId, activeTabForCollapse?.groupId ?? NONE);
        }
    }
}

async function updateIgnoredHostname(hostname, shouldIgnore) {
    const normalizedHostname = String(hostname ?? "").trim().toLowerCase();
    if (!normalizedHostname) throw new Error("A hostname is required.");

    const stored = await chrome.storage.sync.get(DEFAULTS);
    const ignoredHostnames = new Set(
        (stored.ignoredHostnames ?? [])
            .map(value => String(value).trim().toLowerCase())
            .filter(Boolean),
    );
    if (shouldIgnore) ignoredHostnames.add(normalizedHostname);
    else ignoredHostnames.delete(normalizedHostname);

    const nextIgnoredHostnames = [...ignoredHostnames];
    const currentSignature = ignoredHostnamesSignature(stored.ignoredHostnames);
    const nextSignature = ignoredHostnamesSignature(nextIgnoredHostnames);
    if (currentSignature === nextSignature) {
        await enqueueForceReevaluation();
        return;
    }

    let resolveChange;
    let rejectChange;
    const changeCompleted = new Promise((resolve, reject) => {
        resolveChange = resolve;
        rejectChange = reject;
    });
    const waiter = { signature: nextSignature, resolve: resolveChange, reject: rejectChange };
    ignoredHostnameChangeWaiters.push(waiter);

    try {
        await chrome.storage.sync.set({ ignoredHostnames: nextIgnoredHostnames });
        await changeCompleted;
    } catch (error) {
        const waiterIndex = ignoredHostnameChangeWaiters.indexOf(waiter);
        if (waiterIndex !== -1) ignoredHostnameChangeWaiters.splice(waiterIndex, 1);
        throw error;
    }
}

function enqueueIgnoredHostnameUpdate(hostname, shouldIgnore) {
    const update = ignoredHostnameUpdateQueue
        .catch(() => {})
        .then(() => updateIgnoredHostname(hostname, shouldIgnore));
    ignoredHostnameUpdateQueue = update;
    return update;
}

// -------------------- EVENT HANDLERS --------------------

chrome.tabs.onCreated.addListener(async (tab) => {
    try {
        await settingsReady;
        if (!tab || tab.id == null) return;
        if (tab.pinned) return;

        // Use pendingUrl first; some tabs start there before tab.url is set.
        const url = tab.pendingUrl || tab.url;
        const u = safeParseUrl(url);
        if (!isWebUrl(u)) return;

        // Record the first http(s) URL we see for this tab as its “initial URL”.
        if (u?.href) initialUrlByTab.set(tab.id, u.href);

        const grouping = resolveTabGrouping(tab);
        if (!grouping?.identity) {
            await enforceGroupMembershipForTab(tab, grouping);
            return;
        }

        if (underMutationLock()) return;
        if (!shouldProcessTab(tab.id)) return;

        await maybeGroupTab(tab, grouping);

        if (COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS) {
            // Re-fetch the tab so we know its current groupId after grouping logic.
            const refreshed = await chrome.tabs.get(tab.id);
            await collapseAllGroupsExcept(refreshed.windowId, refreshed.groupId);
        }
    } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
        await settingsReady;
        if (!tab || tab.id == null) return;
        if (tab.pinned) return;

        // Only react on meaningful lifecycle updates, but detect URL changes ourselves.
        // Brave sometimes does NOT populate changeInfo.url.
        const isMeaningful =
        changeInfo.url ||
        changeInfo.status === "loading" ||
        changeInfo.status === "complete";

        if (!isMeaningful) return;

        const currentUrl = tab.url || tab.pendingUrl;
        if (!currentUrl) return;

        const u = safeParseUrl(currentUrl);
        if (!isWebUrl(u)) return;

        const grouping = resolveTabGrouping(tab, changeInfo);
        if (!grouping?.identity) {
            await enforceGroupMembershipForTab(tab, grouping);
            lastSeenUrlByTab.set(tabId, currentUrl);
        } else {
            if (underMutationLock()) return;
            if (!shouldProcessTab(tabId)) return;

            const initialUrl = initialUrlByTab.get(tabId);

            // If enabled, ignore grouping while the tab is still on its initial URL.
            if (IGNORE_INITIAL_TAB_URL && initialUrl && currentUrl === initialUrl) {
                // Still update lastSeenUrlByTab so we don’t loop.
                lastSeenUrlByTab.set(tabId, currentUrl);
                return;
            }

            const lastUrl = lastSeenUrlByTab.get(tabId);
            if (lastUrl === currentUrl) return; // no actual URL change we care about

            lastSeenUrlByTab.set(tabId, currentUrl);

            await maybeGroupTab(tab, grouping);
        }

        // Canonical semantics: this helper only ungroups singleton managed groups
        // when UNGROUP_SINGLETON_MANAGED_GROUPS is enabled.
        await cleanupManagedSingletonGroupsInWindow(tab.windowId);

        if (COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS) {
            const refreshed = await chrome.tabs.get(tabId);
            await collapseAllGroupsExcept(refreshed.windowId, refreshed.groupId);
        }
    } catch {}
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        await settingsReady;
        if (underMutationLock()) return;
        await handleActivation(activeInfo.tabId, activeInfo.windowId);
    } catch {}
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
    try {
        await settingsReady;
        if (!removeInfo || removeInfo.windowId == null || removeInfo.isWindowClosing) return;

        // Canonical semantics: this helper only ungroups singleton managed groups
        // when UNGROUP_SINGLETON_MANAGED_GROUPS is enabled.
        await cleanupManagedSingletonGroupsInWindow(removeInfo.windowId);
        await keepManagedGroupsAtFrontInWindow(removeInfo.windowId);
    } catch {}
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
    try {
        await settingsReady;
        if (windowId == null || windowId < 0) return;
        if (underMutationLock()) return;

        const [activeTab] = await chrome.tabs.query({ windowId, active: true });
        if (!activeTab) return;

        await handleActivation(activeTab.id, windowId);
    } catch {}
});

// Cache maintenance
chrome.tabGroups.onRemoved?.addListener((group) => {
    groupTitleCache.delete(group.id);
});
chrome.tabGroups.onUpdated?.addListener((group) => {
    groupTitleCache.set(group.id, group.title ?? null);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const isForceReevaluation = message?.type === "sumtabs:force-reevaluate";
    const isIgnoredHostnameUpdate = message?.type === "sumtabs:update-ignored-hostname";
    if (!isForceReevaluation && !isIgnoredHostnameUpdate) return undefined;

    (async () => {
        try {
            if (isIgnoredHostnameUpdate) {
                await navigator.locks.request(IGNORED_HOSTNAMES_STORAGE_LOCK, () => (
                    enqueueIgnoredHostnameUpdate(message.hostname, message.shouldIgnore === true)
                ));
            } else {
                await enqueueForceReevaluation();
            }
            sendResponse({ ok: true });
        } catch (error) {
            console.error("Failed to process tab reevaluation request", error);
            sendResponse({ ok: false, error: String(error) });
        }
    })();

    return true;
});
