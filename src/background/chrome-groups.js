const VALID_GROUP_COLORS = [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
];

const GROUP_OWNERSHIP_UNGROUPED = "ungrouped";
const GROUP_OWNERSHIP_MANAGED = "managed";
const GROUP_OWNERSHIP_PROTECTED = "protected";

export function createChromeGroups({ chromeApi, getManagedPrefix }) {
    const none = chromeApi.tabGroups.TAB_GROUP_ID_NONE;
    let mutationLockUntil = 0;
    let mutationUnlockTimer = null;
    const mutationUnlockWaiters = new Set();
    const groupTitleCache = new Map();

    function nowMs() {
        return Date.now();
    }

    function underMutationLock() {
        return nowMs() < mutationLockUntil;
    }

    function scheduleMutationUnlock() {
        if (mutationUnlockTimer != null) clearTimeout(mutationUnlockTimer);

        const remainingMs = Math.max(0, mutationLockUntil - nowMs());
        mutationUnlockTimer = setTimeout(() => {
            mutationUnlockTimer = null;
            const waiters = [...mutationUnlockWaiters];
            mutationUnlockWaiters.clear();
            for (const resolve of waiters) resolve();
        }, remainingMs);
    }

    function acquireMutationLock(ms = 250) {
        // Extend lock slightly into the future.
        mutationLockUntil = Math.max(mutationLockUntil, nowMs() + ms);
        if (mutationUnlockWaiters.size > 0) scheduleMutationUnlock();
    }

    function waitForMutationUnlock() {
        if (!underMutationLock()) return Promise.resolve();

        return new Promise((resolve) => {
            mutationUnlockWaiters.add(resolve);
            scheduleMutationUnlock();
        });
    }

    function isManagedGroupTitle(title) {
        return !!title && title.startsWith(getManagedPrefix());
    }

    async function getGroupTitle(groupId, { fresh = false } = {}) {
        if (groupId == null || groupId === none) return null;
        if (!fresh && groupTitleCache.has(groupId)) return groupTitleCache.get(groupId);

        try {
            const group = await chromeApi.tabGroups.get(groupId);
            const title = group?.title ?? null;
            groupTitleCache.set(groupId, title);
            return title;
        } catch {
            groupTitleCache.delete(groupId);
            return null;
        }
    }

    async function classifyGroupOwnership(groupId, { fresh = false } = {}) {
        if (groupId == null || groupId === none) return GROUP_OWNERSHIP_UNGROUPED;

        const title = await getGroupTitle(groupId, { fresh });
        return isManagedGroupTitle(title)
            ? GROUP_OWNERSHIP_MANAGED
            : GROUP_OWNERSHIP_PROTECTED;
    }

    async function classifyTabGroup(tab, options) {
        return classifyGroupOwnership(tab?.groupId, options);
    }

    async function ensureGroupTitle(groupId, title) {
        if (groupId == null || groupId === none) return false;

        try {
            const currentTitle = await getGroupTitle(groupId);
            if (currentTitle === title) return false;

            acquireMutationLock(250);
            await chromeApi.tabGroups.update(groupId, { title });
            groupTitleCache.set(groupId, title);
            return true;
        } catch {
            return false;
        }
    }

    async function ensureGroupColor(groupId, color) {
        if (groupId == null || groupId === none) return false;
        if (!VALID_GROUP_COLORS.includes(color)) return false;

        try {
            const group = await chromeApi.tabGroups.get(groupId);
            if (!isManagedGroupTitle(group?.title)) return false;
            groupTitleCache.set(groupId, group.title);
            if (group?.color === color) return false;

            acquireMutationLock(250);
            await chromeApi.tabGroups.update(groupId, { color });
            return true;
        } catch {
            return false;
        }
    }

    async function setGroupCollapsed(groupId, collapsed) {
        try {
            const group = await chromeApi.tabGroups.get(groupId);
            const title = group?.title ?? null;
            groupTitleCache.set(groupId, title);
            if (!isManagedGroupTitle(title)) return false;
            if (!!group?.collapsed === collapsed) return false;

            acquireMutationLock(250);
            await chromeApi.tabGroups.update(groupId, { collapsed });
            return true;
        } catch {
            return false;
        }
    }

    async function expandGroupIfCollapsed(groupId) {
        if (await classifyGroupOwnership(groupId, { fresh: true }) !== GROUP_OWNERSHIP_MANAGED) return;

        try {
            const group = await chromeApi.tabGroups.get(groupId);
            if (!group?.collapsed) return;
            await setGroupCollapsed(groupId, false);
        } catch {}
    }

    async function runChromiumGroupTitleRenderWorkaround(windowId, originalActiveTabId = null) {
        if (windowId == null) return;

        let blankTabId = null;

        try {
            const [activeTab] = originalActiveTabId == null
                ? await chromeApi.tabs.query({ windowId, active: true })
                : [await chromeApi.tabs.get(originalActiveTabId)];
            if (!activeTab?.id || activeTab.windowId !== windowId) return;

            const collapseStateByGroup = new Map();

            const blankTab = await chromeApi.tabs.create({
                windowId,
                url: "about:blank",
                active: false,
            });
            if (!blankTab?.id) return;

            blankTabId = blankTab.id;

            await chromeApi.tabs.update(blankTabId, { active: true });

            const tabs = await chromeApi.tabs.query({ windowId });
            const groupIds = new Set();

            for (const tab of tabs) {
                if (tab.groupId != null && tab.groupId !== none) groupIds.add(tab.groupId);
            }

            for (const groupId of groupIds) {
                try {
                    const group = await chromeApi.tabGroups.get(groupId);
                    if (!isManagedGroupTitle(group?.title)) continue;
                    groupTitleCache.set(groupId, group.title);
                    collapseStateByGroup.set(groupId, !!group?.collapsed);
                } catch {}
            }

            for (const groupId of collapseStateByGroup.keys()) {
                await setGroupCollapsed(groupId, true);
            }

            await chromeApi.tabs.update(activeTab.id, { active: true });

            for (const [groupId, wasCollapsed] of collapseStateByGroup.entries()) {
                await setGroupCollapsed(groupId, wasCollapsed);
            }
        } catch {
        } finally {
            if (blankTabId != null) {
                try {
                    await chromeApi.tabs.remove(blankTabId);
                } catch {}
            }
        }
    }

    async function ungroupManagedTab(tabId, expectedGroupId) {
        try {
            const tab = await chromeApi.tabs.get(tabId);
            if (!tab || tab.pinned || tab.groupId !== expectedGroupId) return false;
            if (
                await classifyGroupOwnership(expectedGroupId, { fresh: true })
                !== GROUP_OWNERSHIP_MANAGED
            ) return false;

            acquireMutationLock(250);
            await chromeApi.tabs.ungroup(tabId);
            return true;
        } catch {
            return false;
        }
    }

    async function cleanupManagedSingletonGroupsInWindow(windowId, enabled) {
        if (windowId == null) return;

        // false/default => keep singleton grouped; true => ungroup singleton managed group.
        if (!enabled) return;

        try {
            const tabs = await chromeApi.tabs.query({ windowId });
            const tabsByGroupId = new Map();

            for (const tab of tabs) {
                const groupId = tab?.groupId;
                if (groupId == null || groupId === none) continue;

                if (!tabsByGroupId.has(groupId)) tabsByGroupId.set(groupId, []);
                tabsByGroupId.get(groupId).push(tab);
            }

            for (const [groupId, groupedTabs] of tabsByGroupId.entries()) {
                if (groupedTabs.length !== 1) continue;

                const title = await getGroupTitle(groupId, { fresh: true });
                if (!isManagedGroupTitle(title)) continue;

                const [singletonTab] = groupedTabs;
                if (!singletonTab?.id || singletonTab.pinned) continue;

                await ungroupManagedTab(singletonTab.id, groupId);
            }
        } catch {}
    }

    async function keepManagedGroupsAtFrontInWindow(windowId, enabled) {
        if (!enabled || windowId == null) return;

        try {
            const tabs = await chromeApi.tabs.query({ windowId });
            const pinnedTabCount = tabs.filter(tab => tab?.pinned === true).length;
            const managedGroupsById = new Map();

            for (const tab of tabs) {
                const groupId = tab?.groupId;
                if (groupId == null || groupId === none) continue;
                if (managedGroupsById.has(groupId)) continue;

                const title = await getGroupTitle(groupId);
                if (!isManagedGroupTitle(title)) continue;

                managedGroupsById.set(groupId, {
                    id: groupId,
                    firstIndex: Number.isFinite(tab.index) ? tab.index : Number.MAX_SAFE_INTEGER,
                });
            }

            const managedGroups = [...managedGroupsById.values()]
                .sort((a, b) => a.firstIndex - b.firstIndex);

            let targetIndex = pinnedTabCount;
            for (const group of managedGroups) {
                acquireMutationLock(350);
                await chromeApi.tabGroups.move(group.id, { index: targetIndex });

                const movedTabs = await chromeApi.tabs.query({ windowId, groupId: group.id });
                const groupWidth = movedTabs.filter(tab => tab?.pinned !== true).length;
                targetIndex += Math.max(1, groupWidth);
            }
        } catch {}
    }

    function handleGroupRemoved(group) {
        groupTitleCache.delete(group.id);
    }

    function handleGroupUpdated(group) {
        groupTitleCache.set(group.id, group.title ?? null);
    }

    return {
        underMutationLock,
        acquireMutationLock,
        waitForMutationUnlock,
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
    };
}
