// Auto-group tabs by root/registrable domain (with domain-wide + exact-host separation rules) + strict membership enforcement.
// SAFETY VERSION: adds throttles + re-entrancy guards to prevent event storms / runaway loops.
import { DEFAULTS } from "./defaults.js";
import { buildCustomBundleMaps, resolveGroupingForHostname } from "./grouping.js";

// -------------------- SETTINGS --------------------

let settings = structuredClone(DEFAULTS);

// Derived runtime structures
let COMMON_MULTIPART_SUFFIXES = new Set(DEFAULTS.commonMultipartSuffixes);
let EXCLUDED_FROM_ROOT_COLLAPSE = new Set(DEFAULTS.excludedFromRootCollapse);
let AUTO_GROUP_PREFIX = DEFAULTS.autoGroupPrefix;
let COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS = DEFAULTS.collapseOtherGroupsOnNavEvents;
let UNGROUP_SINGLETON_MANAGED_GROUPS = DEFAULTS.ungroupSingletonManagedGroups;
let IGNORE_INITIAL_TAB_URL_FOR_GROUPING = DEFAULTS.ignoreInitialTabUrlForGrouping;
let IGNORE_INITIAL_TAB_URL_FOR_ENFORCEMENT = DEFAULTS.ignoreInitialTabUrlForEnforcement;

let customBundleMaps = {
    exactHostnameToBundleRules: new Map(),
    rootDomainToBundleRules: new Map(),
};
let customIdentityToColor = new Map();
const VALID_GROUP_COLORS = new Set(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

function rebuildDerived() {
    AUTO_GROUP_PREFIX = settings.autoGroupPrefix ?? DEFAULTS.autoGroupPrefix;
    COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS = !!settings.collapseOtherGroupsOnNavEvents;
    UNGROUP_SINGLETON_MANAGED_GROUPS = !!settings.ungroupSingletonManagedGroups;
    IGNORE_INITIAL_TAB_URL_FOR_GROUPING = !!settings.ignoreInitialTabUrlForGrouping;
    IGNORE_INITIAL_TAB_URL_FOR_ENFORCEMENT = !!settings.ignoreInitialTabUrlForEnforcement;

    COMMON_MULTIPART_SUFFIXES = new Set((settings.commonMultipartSuffixes ?? []).map(s => String(s).toLowerCase()));
    EXCLUDED_FROM_ROOT_COLLAPSE = new Set((settings.excludedFromRootCollapse ?? []).map(s => String(s).toLowerCase()));

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
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
    rebuildDerived();
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
        hostname: parsedUrl.hostname,
        parsedUrl,
        commonMultipartSuffixes: COMMON_MULTIPART_SUFFIXES,
        excludedFromRootCollapse: EXCLUDED_FROM_ROOT_COLLAPSE,
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

async function getGroupTitle(groupId) {
    if (groupId == null || groupId === NONE) return null;
    if (groupTitleCache.has(groupId)) return groupTitleCache.get(groupId);

    try {
        const g = await chrome.tabGroups.get(groupId);
        const title = g?.title ?? null;
        groupTitleCache.set(groupId, title);
        return title;
    } catch {
        return null;
    }
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
        if (group?.color === color) return false;

        acquireMutationLock(250);
        await chrome.tabGroups.update(groupId, { color });
        return true;
    } catch {
        return false;
    }
}

async function setGroupCollapsed(groupId, collapsed) {
    try {
        acquireMutationLock(250);
        await chrome.tabGroups.update(groupId, { collapsed });
    } catch {}
}

async function expandGroupIfCollapsed(groupId) {
    if (groupId == null || groupId === NONE) return;

    try {
        const group = await chrome.tabGroups.get(groupId);
        if (!group?.collapsed) return;
        await setGroupCollapsed(groupId, false);
    } catch {}
}

async function runChromiumGroupTitleRenderWorkaround(windowId) {
    if (windowId == null) return;

    let blankTabId = null;

    try {
        const [activeTab] = await chrome.tabs.query({ windowId, active: true });
        if (!activeTab?.id) return;

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
                collapseStateByGroup.set(gid, !!group?.collapsed);
            } catch {}
        }

        for (const gid of groupIds) {
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

async function ungroupTab(tabId) {
    try {
        acquireMutationLock(250);
        await chrome.tabs.ungroup(tabId);
    } catch {}
}

// Returns tabs in window whose CURRENT identity matches groupIdentity.
// Excludes pinned tabs and non-http(s).
async function getMatchingTabs(windowId, groupIdentity) {
    const tabs = await chrome.tabs.query({ windowId });
    const matches = [];

    for (const t of tabs) {
        const grouping = resolveTabGrouping(t);
        if (grouping?.identity === groupIdentity) matches.push(t);
    }
    return matches;
}

// Find group by identity, but only if group title exactly equals identity.
async function findExistingGroupIdForIdentity(matches, groupIdentity) {
    for (const t of matches) {
        const gid = t.groupId;
        if (gid == null || gid === NONE) continue;

        const title = await getGroupTitle(gid);
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

            const title = await getGroupTitle(gid);
            if (!title || !title.startsWith(AUTO_GROUP_PREFIX)) continue;

            const [singletonTab] = groupedTabs;
            if (!singletonTab?.id || singletonTab.pinned) continue;

            await ungroupTab(singletonTab.id);
        }
    } catch {}
}

async function enforceGroupMembershipForTab(tab, currentGrouping) {
    if (!tab || tab.id == null) return;
    if (tab.pinned) return;

    if (IGNORE_INITIAL_TAB_URL_FOR_ENFORCEMENT) {
        const initialUrl = initialUrlByTab.get(tab.id);
        const currentUrl = tab.url || tab.pendingUrl;
        if (initialUrl && currentUrl && currentUrl === initialUrl) return;
    }

    const gid = tab.groupId;
    if (gid == null || gid === NONE) return;

    const title = await getGroupTitle(gid);
    if (!title) return;

    // Only police groups created/managed by this extension.
    if (!title.startsWith(AUTO_GROUP_PREFIX)) return;

    const currentIdentity = currentGrouping?.identity;
    if (!currentIdentity) return;

    // If tab no longer matches the group's identity, ungroup it.
    if (title !== currentIdentity) {
        await ungroupTab(tab.id);
    }
}

async function maybeGroupTab(tab, currentGrouping) {
    if (!tab || tab.id == null || tab.windowId == null) return;
    if (tab.pinned) return;

    // Optional: ignore grouping while the tab is still on its initial URL
    if (IGNORE_INITIAL_TAB_URL_FOR_GROUPING) {
        const initialUrl = initialUrlByTab.get(tab.id);
        const currentUrl = tab.url || tab.pendingUrl;
        if (initialUrl && currentUrl && currentUrl === initialUrl) return;
    }

    const groupIdentity = currentGrouping?.identity;
    if (!groupIdentity) return;

    // Membership enforcement first
    await enforceGroupMembershipForTab(tab, currentGrouping);

    const matches = await getMatchingTabs(tab.windowId, groupIdentity);

    // Only group if 2+ matching tabs exist
    if (matches.length < 2) return;

    const existingGroupId = await findExistingGroupIdForIdentity(matches, groupIdentity);
    const desiredColor = customIdentityToColor.get(groupIdentity);

    if (existingGroupId != null) {
        try {
            acquireMutationLock(300);
            await chrome.tabs.group({ tabIds: [tab.id], groupId: existingGroupId });
            const didRenameGroup = await ensureGroupTitle(existingGroupId, groupIdentity);
            await ensureGroupColor(existingGroupId, desiredColor);
            await expandGroupIfCollapsed(existingGroupId);
            if (didRenameGroup) {
                await runChromiumGroupTitleRenderWorkaround(tab.windowId);
            }
        } catch {}
        return;
    }

    // Create new group containing all matching tabs
    const tabIds = matches.map(t => t.id).filter(id => id != null);
    if (!tabIds.includes(tab.id)) tabIds.push(tab.id);

    try {
        acquireMutationLock(350);
        const newGroupId = await chrome.tabs.group({ tabIds });
        await ensureGroupTitle(newGroupId, groupIdentity);
        await ensureGroupColor(newGroupId, desiredColor);
        await expandGroupIfCollapsed(newGroupId);
        await runChromiumGroupTitleRenderWorkaround(tab.windowId);
    } catch {}
}

async function handleActivation(tabId, windowId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;

    const prevGroupId = lastActiveGroupByWindow.get(windowId);
    const currGroupId = (tab.groupId != null ? tab.groupId : NONE);

    if (prevGroupId != null && prevGroupId !== NONE && prevGroupId !== currGroupId) {
        await setGroupCollapsed(prevGroupId, true);
    }
    if (currGroupId != null && currGroupId !== NONE && currGroupId !== prevGroupId) {
        await setGroupCollapsed(currGroupId, false);
    }

    lastActiveGroupByWindow.set(windowId, currGroupId);
}

async function collapseAllGroupsExcept(windowId, keepGroupId) {
    try {
        const tabs = await chrome.tabs.query({ windowId });
        const groupIds = new Set();

        for (const t of tabs) {
            if (t.groupId != null && t.groupId !== NONE) groupIds.add(t.groupId);
        }

        for (const gid of groupIds) {
            if (keepGroupId != null && keepGroupId !== NONE && gid === keepGroupId) {
                // Keep the active/target group expanded
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

        for (const tab of tabs) {
            if (!tab || tab.id == null || tab.pinned || tab.windowId == null) continue;

            const parsed = safeParseUrl(tab.url || tab.pendingUrl);
            if (!isWebUrl(parsed)) continue;

            const grouping = resolveTabGrouping(tab);
            if (!grouping?.identity) continue;

            await maybeGroupTab(tab, grouping);
        }

        await cleanupManagedSingletonGroupsInWindow(windowId);

        if (COLLAPSE_OTHER_GROUPS_ON_NAV_EVENTS) {
            const [activeTab] = await chrome.tabs.query({ windowId, active: true });
            await collapseAllGroupsExcept(windowId, activeTab?.groupId ?? NONE);
        }

        const refreshedTabs = await chrome.tabs.query({ windowId });

        for (const tab of refreshedTabs) {
            if (!tab || tab.id == null || tab.pinned) continue;
            if (tab.groupId == null || tab.groupId === NONE) continue;

            const title = await getGroupTitle(tab.groupId);
            if (!isManagedGroupTitle(title)) continue;

            const parsed = safeParseUrl(tab.url || tab.pendingUrl);
            if (!isWebUrl(parsed)) continue;

            const grouping = resolveTabGrouping(tab);
            await enforceGroupMembershipForTab(tab, grouping);
        }
    }
}

// -------------------- EVENT HANDLERS --------------------

chrome.tabs.onCreated.addListener(async (tab) => {
    try {
        await settingsReady;
        if (!tab || tab.id == null) return;
        if (tab.pinned) return;

        if (underMutationLock()) return;
        if (!shouldProcessTab(tab.id)) return;

        // Use pendingUrl first; some tabs start there before tab.url is set.
        const url = tab.pendingUrl || tab.url;
        const u = safeParseUrl(url);
        if (!isWebUrl(u)) return;

        // Record the first http(s) URL we see for this tab as its “initial URL”.
        if (u?.href) initialUrlByTab.set(tab.id, u.href);

        const grouping = resolveTabGrouping(tab);
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

        if (underMutationLock()) return;
        if (!shouldProcessTab(tabId)) return;

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

        const initialUrl = initialUrlByTab.get(tabId);

        // If enabled, ignore grouping while the tab is still on its initial URL.
        if (IGNORE_INITIAL_TAB_URL_FOR_GROUPING && initialUrl && currentUrl === initialUrl) {
            // Still update lastSeenUrlByTab so we don’t loop.
            lastSeenUrlByTab.set(tabId, currentUrl);
            return;
        }

        const lastUrl = lastSeenUrlByTab.get(tabId);
        if (lastUrl === currentUrl) return; // no actual URL change we care about

        lastSeenUrlByTab.set(tabId, currentUrl);

        const grouping = resolveTabGrouping(tab, changeInfo);
        await maybeGroupTab(tab, grouping);

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
    if (message?.type !== "sumtabs:force-reevaluate") return undefined;

    (async () => {
        try {
            await forceReevaluateAllWindows();
            sendResponse({ ok: true });
        } catch (error) {
            console.error("Failed to force tab reevaluation", error);
            sendResponse({ ok: false, error: String(error) });
        }
    })();

    return true;
});
