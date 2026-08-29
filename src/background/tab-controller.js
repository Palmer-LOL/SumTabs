import { resolveGroupingForHostname } from "../core/grouping.js";
import { isWebUrl, safeParseUrl } from "../core/urls.js";

const TAB_DEBOUNCE_MS = 750;
const GROUP_OWNERSHIP_MANAGED = "managed";
const GROUP_OWNERSHIP_PROTECTED = "protected";

export function createTabController({ chromeApi, settingsState, chromeGroups }) {
    const none = chromeApi.tabGroups.TAB_GROUP_ID_NONE;
    let reevaluationQueue = Promise.resolve();
    const lastProcessedAt = new Map();
    const lastActiveGroupByWindow = new Map();
    const lastSeenUrlByTab = new Map();
    const initialUrlByTab = new Map();

    function nowMs() {
        return Date.now();
    }

    function shouldProcessTab(tabId) {
        const currentTime = nowMs();
        const lastProcessedTime = lastProcessedAt.get(tabId) || 0;
        if (currentTime - lastProcessedTime < TAB_DEBOUNCE_MS) return false;
        lastProcessedAt.set(tabId, currentTime);
        return true;
    }

    setInterval(() => {
        const cutoff = nowMs() - 10 * 60 * 1000;
        for (const [tabId, processedAt] of lastProcessedAt.entries()) {
            if (processedAt < cutoff) {
                lastProcessedAt.delete(tabId);
                lastSeenUrlByTab.delete(tabId);
                initialUrlByTab.delete(tabId);
            }
        }
    }, 5 * 60 * 1000);

    function getParsedUrlFromTab(tab, changeInfo) {
        const url = (changeInfo && changeInfo.url) || tab?.url || tab?.pendingUrl;
        const parsedUrl = safeParseUrl(url);
        if (!isWebUrl(parsedUrl)) return null;
        return parsedUrl;
    }

    function getGroupingForUrl(parsedUrl) {
        const runtime = settingsState.getRuntime();
        // Shared precedence lives in grouping.js: exact custom bundles first, then inherited root-domain bundles, then default separation rules.
        return resolveGroupingForHostname({
            url: parsedUrl.href,
            hostname: parsedUrl.hostname,
            pathname: parsedUrl.pathname,
            commonMultipartSuffixes: runtime.commonMultipartSuffixes,
            excludedFromRootCollapse: runtime.excludedFromRootCollapse,
            ignoredHostnames: runtime.ignoredHostnames,
            customBundleMaps: runtime.customBundleMaps,
            managedPrefix: runtime.autoGroupPrefix,
        });
    }

    function resolveTabGrouping(tab, changeInfo) {
        if (!tab || tab.pinned) return null;

        const parsedUrl = getParsedUrlFromTab(tab, changeInfo);
        if (!parsedUrl) return null;

        return getGroupingForUrl(parsedUrl);
    }

    async function getEligibleMatchingTabs(windowId, groupIdentity) {
        const tabs = await chromeApi.tabs.query({ windowId });
        const matches = [];

        for (const tab of tabs) {
            const grouping = resolveTabGrouping(tab);
            if (grouping?.identity !== groupIdentity) continue;

            const ownership = await chromeGroups.classifyTabGroup(tab);
            if (ownership === GROUP_OWNERSHIP_PROTECTED) continue;

            matches.push(tab);
        }
        return matches;
    }

    async function revalidateEligibleMatchingTabs(candidates, windowId, groupIdentity) {
        const matches = [];

        for (const candidate of candidates) {
            if (candidate?.id == null) continue;

            try {
                const current = await chromeApi.tabs.get(candidate.id);
                if (!current || current.pinned || current.windowId !== windowId) continue;

                const grouping = resolveTabGrouping(current);
                if (grouping?.identity !== groupIdentity) continue;

                const ownership = await chromeGroups.classifyTabGroup(current, { fresh: true });
                if (ownership === GROUP_OWNERSHIP_PROTECTED) continue;

                matches.push(current);
            } catch {}
        }

        return matches;
    }

    async function findExistingGroupIdForIdentity(matches, groupIdentity, { fresh = false } = {}) {
        for (const tab of matches) {
            const groupId = tab.groupId;
            if (groupId == null || groupId === none) continue;

            const title = await chromeGroups.getGroupTitle(groupId, { fresh });
            if (title === groupIdentity) return groupId;
        }
        return null;
    }

    async function enforceGroupMembershipForTab(tab, currentGrouping) {
        if (!tab || tab.id == null) return;
        if (tab.pinned) return;

        const runtime = settingsState.getRuntime();

        // A missing identity (including an ignored hostname) must be enforced
        // immediately so ignore rules retain absolute precedence.
        if (runtime.ignoreInitialTabUrl && currentGrouping?.identity) {
            const initialUrl = initialUrlByTab.get(tab.id);
            const currentUrl = tab.url || tab.pendingUrl;
            if (initialUrl && currentUrl && currentUrl === initialUrl) return;
        }

        const groupId = tab.groupId;
        if (groupId == null || groupId === none) return;

        const ownership = await chromeGroups.classifyGroupOwnership(groupId, { fresh: true });

        // Only police groups created/managed by this extension. Unknown groups fail closed.
        if (ownership !== GROUP_OWNERSHIP_MANAGED) return;

        const title = await chromeGroups.getGroupTitle(groupId);

        const currentIdentity = currentGrouping?.identity;

        // Ignored hostnames have no identity and must leave managed groups. Other
        // identity changes continue to receive strict membership enforcement.
        if (!currentIdentity || title !== currentIdentity) {
            await chromeGroups.ungroupManagedTab(tab.id, groupId);
        }
    }

    async function maybeGroupTab(tab, currentGrouping, originalActiveTabId = null) {
        if (!tab || tab.id == null || tab.windowId == null) return;
        if (tab.pinned) return;

        // User-created groups are protected. SumTabs only acts on ungrouped tabs or its own prefixed groups.
        if (
            await chromeGroups.classifyTabGroup(tab, { fresh: true })
            === GROUP_OWNERSHIP_PROTECTED
        ) return;

        // Optional: ignore grouping while the tab is still on its initial URL
        if (settingsState.getRuntime().ignoreInitialTabUrl) {
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
        if (matches.length < settingsState.getRuntime().minTabsToGroup) return;

        // Re-fetch ownership and identity immediately before mutation to minimize races with user actions.
        matches = await revalidateEligibleMatchingTabs(matches, tab.windowId, groupIdentity);
        if (matches.length < settingsState.getRuntime().minTabsToGroup) return;
        if (!matches.some(candidate => candidate.id === tab.id)) return;

        const existingGroupId = await findExistingGroupIdForIdentity(
            matches,
            groupIdentity,
            { fresh: true },
        );
        const desiredColor = settingsState.getRuntime().customIdentityToColor.get(groupIdentity);

        if (existingGroupId != null) {
            const [currentTab] = await revalidateEligibleMatchingTabs(
                [tab],
                tab.windowId,
                groupIdentity,
            );
            if (!currentTab) return;
            if (
                await chromeGroups.classifyGroupOwnership(existingGroupId, { fresh: true })
                !== GROUP_OWNERSHIP_MANAGED
            ) return;

            try {
                chromeGroups.acquireMutationLock(300);
                await chromeApi.tabs.group({ tabIds: [tab.id], groupId: existingGroupId });
                await chromeGroups.ensureGroupColor(existingGroupId, desiredColor);
                await chromeGroups.expandGroupIfCollapsed(existingGroupId);
            } catch {}
            return;
        }

        // Revalidate once more before creating a group; the browser API has no atomic ownership precondition.
        matches = await revalidateEligibleMatchingTabs(matches, tab.windowId, groupIdentity);
        if (matches.length < settingsState.getRuntime().minTabsToGroup) return;
        if (!matches.some(candidate => candidate.id === tab.id)) return;

        // Create new group containing all currently eligible matching tabs.
        const tabIds = matches.map(candidate => candidate.id).filter(id => id != null);

        try {
            chromeGroups.acquireMutationLock(350);
            const newGroupId = await chromeApi.tabs.group({ tabIds });
            await chromeGroups.ensureGroupTitle(newGroupId, groupIdentity);
            await chromeGroups.ensureGroupColor(newGroupId, desiredColor);
            await chromeGroups.expandGroupIfCollapsed(newGroupId);
            await chromeGroups.keepManagedGroupsAtFrontInWindow(
                tab.windowId,
                settingsState.getRuntime().keepManagedGroupsAtFront,
            );
            await chromeGroups.runChromiumGroupTitleRenderWorkaround(
                tab.windowId,
                originalActiveTabId,
            );
        } catch {}
    }

    async function handleActivation(tabId, windowId) {
        const tab = await chromeApi.tabs.get(tabId);
        if (!tab) return;

        const previousGroupId = lastActiveGroupByWindow.get(windowId);
        const currentGroupId = tab.groupId != null ? tab.groupId : none;
        const currentOwnership = await chromeGroups.classifyGroupOwnership(
            currentGroupId,
            { fresh: true },
        );

        // Focus mode pauses while the user is working inside a user-created group,
        // but keep the previously active managed group tracked so it can still be
        // collapsed when focus later moves to another managed group.
        if (currentOwnership === GROUP_OWNERSHIP_PROTECTED) return;

        lastActiveGroupByWindow.set(windowId, currentGroupId);

        if (
            previousGroupId != null
            && previousGroupId !== none
            && previousGroupId !== currentGroupId
        ) {
            await chromeGroups.setGroupCollapsed(previousGroupId, true);
        }
        if (currentOwnership === GROUP_OWNERSHIP_MANAGED && currentGroupId !== previousGroupId) {
            await chromeGroups.setGroupCollapsed(currentGroupId, false);
        }
    }

    async function collapseAllGroupsExcept(windowId, keepGroupId) {
        try {
            const keepOwnership = await chromeGroups.classifyGroupOwnership(
                keepGroupId,
                { fresh: true },
            );
            if (keepOwnership === GROUP_OWNERSHIP_PROTECTED) return;

            const tabs = await chromeApi.tabs.query({ windowId });
            const groupIds = new Set();

            for (const tab of tabs) {
                if (tab.groupId != null && tab.groupId !== none) groupIds.add(tab.groupId);
            }

            for (const groupId of groupIds) {
                if (
                    await chromeGroups.classifyGroupOwnership(groupId, { fresh: true })
                    !== GROUP_OWNERSHIP_MANAGED
                ) continue;

                if (keepOwnership === GROUP_OWNERSHIP_MANAGED && groupId === keepGroupId) {
                    // Keep the active/target managed group expanded.
                    await chromeGroups.setGroupCollapsed(groupId, false);
                } else {
                    await chromeGroups.setGroupCollapsed(groupId, true);
                }
            }
        } catch {}
    }

    async function forceReevaluateAllWindows() {
        await settingsState.awaitReady();

        const windows = await chromeApi.windows.getAll();

        for (const window of windows) {
            const windowId = window?.id;
            if (windowId == null) continue;

            const tabs = await chromeApi.tabs.query({ windowId });
            const originalActiveTabId = tabs.find(tab => tab.active)?.id ?? null;

            for (const tab of tabs) {
                if (!tab || tab.id == null || tab.pinned || tab.windowId == null) continue;

                const parsedUrl = safeParseUrl(tab.url || tab.pendingUrl);
                if (!isWebUrl(parsedUrl)) continue;

                const grouping = resolveTabGrouping(tab);
                await maybeGroupTab(tab, grouping, originalActiveTabId);
            }

            let runtime = settingsState.getRuntime();
            await chromeGroups.cleanupManagedSingletonGroupsInWindow(
                windowId,
                runtime.ungroupSingletonManagedGroups,
            );

            const refreshedTabs = await chromeApi.tabs.query({ windowId });

            for (const tab of refreshedTabs) {
                if (!tab || tab.id == null || tab.pinned) continue;
                if (tab.groupId == null || tab.groupId === none) continue;

                if (
                    await chromeGroups.classifyGroupOwnership(tab.groupId, { fresh: true })
                    !== GROUP_OWNERSHIP_MANAGED
                ) continue;

                const parsedUrl = safeParseUrl(tab.url || tab.pendingUrl);
                if (!isWebUrl(parsedUrl)) continue;

                const grouping = resolveTabGrouping(tab);
                await enforceGroupMembershipForTab(tab, grouping);
            }

            runtime = settingsState.getRuntime();
            await chromeGroups.keepManagedGroupsAtFrontInWindow(
                windowId,
                runtime.keepManagedGroupsAtFront,
            );
            let restoredActiveTab = null;
            if (originalActiveTabId != null) {
                try {
                    const originalActiveTab = await chromeApi.tabs.get(originalActiveTabId);
                    if (originalActiveTab?.windowId === windowId) {
                        restoredActiveTab = await chromeApi.tabs.update(
                            originalActiveTabId,
                            { active: true },
                        );
                    }
                } catch {}
            }

            runtime = settingsState.getRuntime();
            if (runtime.collapseOtherGroupsOnNavEvents) {
                let activeTabForCollapse = restoredActiveTab;
                if (!activeTabForCollapse) {
                    [activeTabForCollapse] = await chromeApi.tabs.query({
                        windowId,
                        active: true,
                    });
                }
                await collapseAllGroupsExcept(
                    windowId,
                    activeTabForCollapse?.groupId ?? none,
                );
            }
        }
    }

    function enqueueForceReevaluation() {
        const reevaluation = reevaluationQueue
            .catch(() => {})
            .then(() => forceReevaluateAllWindows());
        reevaluationQueue = reevaluation;
        return reevaluation;
    }

    async function handleTabCreated(tab) {
        try {
            await settingsState.awaitReady();
            if (!tab || tab.id == null) return;
            if (tab.pinned) return;

            // Use pendingUrl first; some tabs start there before tab.url is set.
            const url = tab.pendingUrl || tab.url;
            const parsedUrl = safeParseUrl(url);
            if (!isWebUrl(parsedUrl)) return;

            // Record the first http(s) URL we see for this tab as its “initial URL”.
            if (parsedUrl?.href) initialUrlByTab.set(tab.id, parsedUrl.href);

            const grouping = resolveTabGrouping(tab);
            if (!grouping?.identity) {
                await enforceGroupMembershipForTab(tab, grouping);
                return;
            }

            if (chromeGroups.underMutationLock()) return;
            if (!shouldProcessTab(tab.id)) return;

            await maybeGroupTab(tab, grouping);

            if (settingsState.getRuntime().collapseOtherGroupsOnNavEvents) {
                // Re-fetch the tab so we know its current groupId after grouping logic.
                const refreshed = await chromeApi.tabs.get(tab.id);
                await collapseAllGroupsExcept(refreshed.windowId, refreshed.groupId);
            }
        } catch {}
    }

    async function handleTabUpdated(tabId, changeInfo, tab) {
        try {
            await settingsState.awaitReady();
            if (!tab || tab.id == null) return;
            if (tab.pinned) return;

            // Only react on meaningful lifecycle updates, but detect URL changes ourselves.
            // Brave sometimes does NOT populate changeInfo.url.
            const isMeaningful =
                changeInfo.url
                || changeInfo.status === "loading"
                || changeInfo.status === "complete";

            if (!isMeaningful) return;

            const currentUrl = tab.url || tab.pendingUrl;
            if (!currentUrl) return;

            const parsedUrl = safeParseUrl(currentUrl);
            if (!isWebUrl(parsedUrl)) return;

            const grouping = resolveTabGrouping(tab, changeInfo);
            if (!grouping?.identity) {
                await enforceGroupMembershipForTab(tab, grouping);
                lastSeenUrlByTab.set(tabId, currentUrl);
            } else {
                if (chromeGroups.underMutationLock()) return;
                if (!shouldProcessTab(tabId)) return;

                const initialUrl = initialUrlByTab.get(tabId);

                // If enabled, ignore grouping while the tab is still on its initial URL.
                if (
                    settingsState.getRuntime().ignoreInitialTabUrl
                    && initialUrl
                    && currentUrl === initialUrl
                ) {
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
            await chromeGroups.cleanupManagedSingletonGroupsInWindow(
                tab.windowId,
                settingsState.getRuntime().ungroupSingletonManagedGroups,
            );

            if (settingsState.getRuntime().collapseOtherGroupsOnNavEvents) {
                const refreshed = await chromeApi.tabs.get(tabId);
                await collapseAllGroupsExcept(refreshed.windowId, refreshed.groupId);
            }
        } catch {}
    }

    async function handleTabActivated(activeInfo) {
        try {
            await settingsState.awaitReady();
            if (chromeGroups.underMutationLock()) return;
            await handleActivation(activeInfo.tabId, activeInfo.windowId);
        } catch {}
    }

    async function handleTabRemoved(_tabId, removeInfo) {
        try {
            await settingsState.awaitReady();
            if (!removeInfo || removeInfo.windowId == null || removeInfo.isWindowClosing) return;

            // Canonical semantics: this helper only ungroups singleton managed groups
            // when UNGROUP_SINGLETON_MANAGED_GROUPS is enabled.
            await chromeGroups.cleanupManagedSingletonGroupsInWindow(
                removeInfo.windowId,
                settingsState.getRuntime().ungroupSingletonManagedGroups,
            );
            await chromeGroups.keepManagedGroupsAtFrontInWindow(
                removeInfo.windowId,
                settingsState.getRuntime().keepManagedGroupsAtFront,
            );
        } catch {}
    }

    async function handleWindowFocusChanged(windowId) {
        try {
            await settingsState.awaitReady();
            if (windowId == null || windowId < 0) return;
            if (chromeGroups.underMutationLock()) return;

            const [activeTab] = await chromeApi.tabs.query({ windowId, active: true });
            if (!activeTab) return;

            await handleActivation(activeTab.id, windowId);
        } catch {}
    }

    function handleTabGroupRemoved(group) {
        chromeGroups.handleGroupRemoved(group);
    }

    function handleTabGroupUpdated(group) {
        chromeGroups.handleGroupUpdated(group);
    }

    function handleRuntimeMessage(message) {
        const isForceReevaluation = message?.type === "sumtabs:force-reevaluate";
        const isIgnoredHostnameUpdate = message?.type === "sumtabs:update-ignored-hostname";
        if (!isForceReevaluation && !isIgnoredHostnameUpdate) return null;

        return (async () => {
            try {
                if (isIgnoredHostnameUpdate) {
                    await settingsState.updateIgnoredHostnameWithLock(
                        message.hostname,
                        message.shouldIgnore === true,
                        enqueueForceReevaluation,
                    );
                } else {
                    await enqueueForceReevaluation();
                }
                return { ok: true };
            } catch (error) {
                console.error("Failed to process tab reevaluation request", error);
                return { ok: false, error: String(error) };
            }
        })();
    }

    return {
        enqueueForceReevaluation,
        handleTabCreated,
        handleTabUpdated,
        handleTabActivated,
        handleTabRemoved,
        handleWindowFocusChanged,
        handleTabGroupRemoved,
        handleTabGroupUpdated,
        handleRuntimeMessage,
    };
}
