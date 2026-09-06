import { afterEach, describe, expect, it, vi } from "vitest";
import { createChromeGroups } from "../../src/background/chrome-groups.js";
import { createTabController } from "../../src/background/tab-controller.js";

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

function runtimeSettings(minTabsToGroup) {
    return {
        autoGroupPrefix: "∑ ",
        minTabsToGroup,
        collapseOtherGroupsOnNavEvents: false,
        keepManagedGroupsAtFront: false,
        ungroupSingletonManagedGroups: false,
        ignoreInitialTabUrl: false,
    };
}

describe("tab controller runtime settings", () => {
    afterEach(() => vi.useRealTimers());

    it("uses the updated grouping threshold after awaited match discovery", async () => {
        vi.useFakeTimers();

        const firstTab = {
            id: 1,
            windowId: 10,
            groupId: -1,
            pinned: false,
            url: "https://one.example.test/",
        };
        const secondTab = {
            id: 2,
            windowId: 10,
            groupId: -1,
            pinned: false,
            url: "https://two.example.test/",
        };
        const tabsById = new Map([
            [firstTab.id, firstTab],
            [secondTab.id, secondTab],
        ]);

        let resolveMatchQuery;
        let notifyMatchQueryStarted;
        const matchQueryStarted = new Promise((resolve) => {
            notifyMatchQueryStarted = resolve;
        });
        const matchQuery = new Promise((resolve) => {
            resolveMatchQuery = resolve;
        });

        const groupTabs = vi.fn(async () => 20);
        const chromeApi = {
            tabGroups: { TAB_GROUP_ID_NONE: -1 },
            tabs: {
                query: vi.fn(() => {
                    notifyMatchQueryStarted();
                    return matchQuery;
                }),
                get: vi.fn(async (tabId) => tabsById.get(tabId)),
                group: groupTabs,
            },
        };

        let minTabsToGroup = 2;
        const settingsState = {
            startInitialLoad: vi.fn(async () => {}),
            awaitReady: vi.fn(async () => {}),
            reload: vi.fn(async () => {}),
            getRuntime: vi.fn(() => runtimeSettings(minTabsToGroup)),
            resolveGroupingForUrl: vi.fn(() => ({ identity: "∑ example.test" })),
            getCustomIdentityColor: vi.fn(() => undefined),
            handleStorageChange: vi.fn(),
            enqueueIgnoredHostnameUpdate: vi.fn(async () => {}),
            updateIgnoredHostnameWithLock: vi.fn(async () => {}),
        };
        const chromeGroups = {
            underMutationLock: vi.fn(() => false),
            acquireMutationLock: vi.fn(),
            classifyTabGroup: vi.fn(async () => "ungrouped"),
            classifyGroupOwnership: vi.fn(async () => "managed"),
            getGroupTitle: vi.fn(async () => null),
            ensureGroupTitle: vi.fn(async () => true),
            ensureGroupColor: vi.fn(async () => true),
            expandGroupIfCollapsed: vi.fn(async () => {}),
            ungroupManagedTab: vi.fn(async () => true),
            keepManagedGroupsAtFrontInWindow: vi.fn(async () => {}),
            runChromiumGroupTitleRenderWorkaround: vi.fn(async () => {}),
            cleanupManagedSingletonGroupsInWindow: vi.fn(async () => {}),
            setGroupCollapsed: vi.fn(async () => true),
            handleGroupRemoved: vi.fn(),
            handleGroupUpdated: vi.fn(),
        };

        const controller = createTabController({ chromeApi, settingsState, chromeGroups });
        const handling = controller.handleTabCreated(firstTab);

        await matchQueryStarted;
        minTabsToGroup = 3;
        resolveMatchQuery([firstTab, secondTab]);
        await handling;

        expect(groupTabs).not.toHaveBeenCalled();
        expect(settingsState.resolveGroupingForUrl).toHaveBeenCalled();
    });

    it("delegates grouping and color lookup without requiring rule collections in getRuntime", async () => {
        vi.useFakeTimers();

        const tabs = [
            {
                id: 1,
                windowId: 10,
                groupId: -1,
                pinned: false,
                url: "https://one.example.test/",
            },
            {
                id: 2,
                windowId: 10,
                groupId: -1,
                pinned: false,
                url: "https://two.example.test/",
            },
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
        const chromeApi = {
            tabGroups: { TAB_GROUP_ID_NONE: -1 },
            tabs: {
                query: vi.fn(async () => tabs),
                get: vi.fn(async (tabId) => tabsById.get(tabId)),
                group: vi.fn(async () => 20),
            },
        };
        const settingsState = {
            awaitReady: vi.fn(async () => {}),
            getRuntime: vi.fn(() => Object.freeze(runtimeSettings(2))),
            resolveGroupingForUrl: vi.fn(() => ({ identity: "∑ example.test" })),
            getCustomIdentityColor: vi.fn(() => "purple"),
        };
        const chromeGroups = {
            underMutationLock: vi.fn(() => false),
            acquireMutationLock: vi.fn(),
            classifyTabGroup: vi.fn(async () => "ungrouped"),
            classifyGroupOwnership: vi.fn(async () => "managed"),
            getGroupTitle: vi.fn(async () => null),
            ensureGroupTitle: vi.fn(async () => true),
            ensureGroupColor: vi.fn(async () => true),
            expandGroupIfCollapsed: vi.fn(async () => {}),
            ungroupManagedTab: vi.fn(async () => true),
            keepManagedGroupsAtFrontInWindow: vi.fn(async () => {}),
            runChromiumGroupTitleRenderWorkaround: vi.fn(async () => {}),
        };

        const controller = createTabController({ chromeApi, settingsState, chromeGroups });
        await controller.handleTabCreated(tabs[0]);

        expect(settingsState.resolveGroupingForUrl).toHaveBeenCalled();
        expect(settingsState.getCustomIdentityColor).toHaveBeenCalledWith("∑ example.test");
        expect(chromeGroups.ensureGroupColor).toHaveBeenCalledWith(20, "purple");
        expect(Object.values(settingsState.getRuntime())).not.toContainEqual(expect.any(Map));
        expect(Object.values(settingsState.getRuntime())).not.toContainEqual(expect.any(Set));
    });
});

describe("tab controller managed-group focus", () => {
    function createFocusHarness({ activeGroupId, focusEnabled = true, activeUrl = "https://active.test/" }) {
        const tabs = [
            {
                id: 1,
                windowId: 10,
                groupId: activeGroupId,
                active: true,
                pinned: false,
                url: activeUrl,
            },
            {
                id: 2,
                windowId: 10,
                groupId: 200,
                active: false,
                pinned: false,
                url: "https://managed-one.test/",
            },
            {
                id: 3,
                windowId: 10,
                groupId: 300,
                active: false,
                pinned: false,
                url: "https://managed-two.test/",
            },
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
        const ownershipByGroupId = new Map([
            [100, "protected"],
            [200, "managed"],
            [300, "managed"],
        ]);
        const titleByGroupId = new Map([
            [200, "∑ managed-one.test"],
            [300, "∑ managed-two.test"],
        ]);
        const setGroupCollapsed = vi.fn(async () => true);
        const chromeApi = {
            tabGroups: { TAB_GROUP_ID_NONE: -1 },
            windows: { getAll: vi.fn(async () => [{ id: 10 }]) },
            tabs: {
                query: vi.fn(async ({ active } = {}) => active ? tabs.filter(tab => tab.active) : tabs),
                get: vi.fn(async (tabId) => tabsById.get(tabId)),
                update: vi.fn(async (tabId) => tabsById.get(tabId)),
                group: vi.fn(),
            },
        };
        const settingsState = {
            awaitReady: vi.fn(async () => {}),
            getRuntime: vi.fn(() => ({
                ...runtimeSettings(2),
                collapseOtherGroupsOnNavEvents: focusEnabled,
            })),
            resolveGroupingForUrl: vi.fn((parsedUrl) => ({
                identity: `∑ ${parsedUrl.hostname}`,
            })),
            getCustomIdentityColor: vi.fn(() => undefined),
        };
        const chromeGroups = {
            underMutationLock: vi.fn(() => false),
            acquireMutationLock: vi.fn(),
            waitForMutationUnlock: vi.fn(async () => {}),
            classifyTabGroup: vi.fn(async (tab) => ownershipByGroupId.get(tab.groupId) || "ungrouped"),
            classifyGroupOwnership: vi.fn(async (groupId) => ownershipByGroupId.get(groupId) || "ungrouped"),
            getGroupTitle: vi.fn(async (groupId) => titleByGroupId.get(groupId) || null),
            ensureGroupTitle: vi.fn(async () => true),
            ensureGroupColor: vi.fn(async () => true),
            expandGroupIfCollapsed: vi.fn(async () => {}),
            ungroupManagedTab: vi.fn(async () => true),
            keepManagedGroupsAtFrontInWindow: vi.fn(async () => {}),
            runChromiumGroupTitleRenderWorkaround: vi.fn(async () => {}),
            cleanupManagedSingletonGroupsInWindow: vi.fn(async () => {}),
            setGroupCollapsed,
            handleGroupRemoved: vi.fn(),
            handleGroupUpdated: vi.fn(),
        };

        return {
            controller: createTabController({ chromeApi, settingsState, chromeGroups }),
            setGroupCollapsed,
        };
    }

    it("collapses every managed group when focus is enabled and the active group is protected", async () => {
        const { controller, setGroupCollapsed } = createFocusHarness({ activeGroupId: 100 });

        await controller.handleTabActivated({ tabId: 1, windowId: 10 });

        expect(setGroupCollapsed).toHaveBeenCalledTimes(2);
        expect(setGroupCollapsed).toHaveBeenCalledWith(200, true);
        expect(setGroupCollapsed).toHaveBeenCalledWith(300, true);
        expect(setGroupCollapsed).not.toHaveBeenCalledWith(100, expect.any(Boolean));
    });

    it("expands the active managed group and collapses every other managed group", async () => {
        const { controller, setGroupCollapsed } = createFocusHarness({ activeGroupId: 200 });

        await controller.handleTabActivated({ tabId: 1, windowId: 10 });

        expect(setGroupCollapsed).toHaveBeenCalledTimes(2);
        expect(setGroupCollapsed).toHaveBeenCalledWith(200, false);
        expect(setGroupCollapsed).toHaveBeenCalledWith(300, true);
        expect(setGroupCollapsed).not.toHaveBeenCalledWith(100, expect.any(Boolean));
    });

    it("does not mutate collapse state on activation when focus mode is disabled", async () => {
        const { controller, setGroupCollapsed } = createFocusHarness({
            activeGroupId: 200,
            focusEnabled: false,
        });

        await controller.handleTabActivated({ tabId: 1, windowId: 10 });

        expect(setGroupCollapsed).not.toHaveBeenCalled();
    });

    it("applies focus after forced reevaluation even when the active protected tab uses brave://", async () => {
        const { controller, setGroupCollapsed } = createFocusHarness({
            activeGroupId: 100,
            activeUrl: "brave://settings/",
        });

        await controller.handleRuntimeMessage({ type: "sumtabs:force-reevaluate" });

        expect(setGroupCollapsed).toHaveBeenCalledTimes(2);
        expect(setGroupCollapsed).toHaveBeenCalledWith(200, true);
        expect(setGroupCollapsed).toHaveBeenCalledWith(300, true);
        expect(setGroupCollapsed).not.toHaveBeenCalledWith(100, expect.any(Boolean));
    });

    it("lets the newest rapid activation determine the final managed-group focus state", async () => {
        const tabs = [
            { id: 1, windowId: 10, groupId: 200, active: true },
            { id: 2, windowId: 10, groupId: 300, active: false },
        ];
        const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
        const collapsedByGroupId = new Map([
            [200, true],
            [300, true],
        ]);
        const firstWriteStarted = createDeferred();
        const releaseFirstWrite = createDeferred();
        let shouldDelayFirstWrite = true;

        const setGroupCollapsed = vi.fn(async (groupId, collapsed) => {
            if (shouldDelayFirstWrite && groupId === 200 && collapsed === false) {
                shouldDelayFirstWrite = false;
                firstWriteStarted.resolve();
                await releaseFirstWrite.promise;
            }
            collapsedByGroupId.set(groupId, collapsed);
            return true;
        });
        const chromeApi = {
            tabGroups: { TAB_GROUP_ID_NONE: -1 },
            tabs: {
                get: vi.fn(async tabId => tabsById.get(tabId)),
                query: vi.fn(async ({ active } = {}) => active
                    ? tabs.filter(tab => tab.active)
                    : tabs),
            },
        };
        const settingsState = {
            awaitReady: vi.fn(async () => {}),
            getRuntime: vi.fn(() => ({
                ...runtimeSettings(2),
                collapseOtherGroupsOnNavEvents: true,
            })),
        };
        const chromeGroups = {
            underMutationLock: vi.fn(() => false),
            waitForMutationUnlock: vi.fn(async () => {}),
            classifyGroupOwnership: vi.fn(async () => "managed"),
            setGroupCollapsed,
        };
        const controller = createTabController({ chromeApi, settingsState, chromeGroups });

        const firstActivation = controller.handleTabActivated({ tabId: 1, windowId: 10 });
        await firstWriteStarted.promise;

        tabs[0].active = false;
        tabs[1].active = true;
        const secondActivation = controller.handleTabActivated({ tabId: 2, windowId: 10 });
        await new Promise(resolve => setTimeout(resolve, 0));

        releaseFirstWrite.resolve();
        await Promise.all([firstActivation, secondActivation]);

        expect(collapsedByGroupId).toEqual(new Map([
            [200, true],
            [300, false],
        ]));
    });

    it("coalesces duplicate activation and window-focus requests while focus application is deferred", async () => {
        const unlock = createDeferred();
        const tabs = [
            { id: 1, windowId: 10, groupId: 200, active: true },
            { id: 2, windowId: 10, groupId: 300, active: false },
        ];
        const setGroupCollapsed = vi.fn(async () => true);
        const chromeApi = {
            tabGroups: { TAB_GROUP_ID_NONE: -1 },
            tabs: {
                get: vi.fn(async tabId => tabs.find(tab => tab.id === tabId)),
                query: vi.fn(async ({ active } = {}) => active
                    ? tabs.filter(tab => tab.active)
                    : tabs),
            },
        };
        const settingsState = {
            awaitReady: vi.fn(async () => {}),
            getRuntime: vi.fn(() => ({
                ...runtimeSettings(2),
                collapseOtherGroupsOnNavEvents: true,
            })),
        };
        const chromeGroups = {
            underMutationLock: vi.fn(() => false),
            waitForMutationUnlock: vi.fn(() => unlock.promise),
            classifyGroupOwnership: vi.fn(async () => "managed"),
            setGroupCollapsed,
        };
        const controller = createTabController({ chromeApi, settingsState, chromeGroups });

        const requests = [
            controller.handleTabActivated({ tabId: 1, windowId: 10 }),
            controller.handleTabActivated({ tabId: 1, windowId: 10 }),
            controller.handleWindowFocusChanged(10),
        ];
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(setGroupCollapsed).not.toHaveBeenCalled();

        unlock.resolve();
        await Promise.all(requests);

        expect(chromeApi.tabs.query).toHaveBeenCalledTimes(2);
        expect(chromeApi.tabs.query).toHaveBeenNthCalledWith(1, { windowId: 10, active: true });
        expect(chromeApi.tabs.query).toHaveBeenNthCalledWith(2, { windowId: 10 });
        expect(setGroupCollapsed).toHaveBeenCalledTimes(2);
    });

    it("applies an activation that arrives while the real mutation lock is held", async () => {
        vi.useFakeTimers();

        const tabs = [
            { id: 1, windowId: 10, groupId: 200, active: true },
            { id: 2, windowId: 10, groupId: 300, active: false },
        ];
        const groupsById = new Map([
            [200, { id: 200, title: "∑ active.test", collapsed: true }],
            [300, { id: 300, title: "∑ other.test", collapsed: false }],
        ]);
        const updateGroup = vi.fn(async (groupId, changes) => {
            Object.assign(groupsById.get(groupId), changes);
            return groupsById.get(groupId);
        });
        const chromeApi = {
            tabGroups: {
                TAB_GROUP_ID_NONE: -1,
                get: vi.fn(async groupId => groupsById.get(groupId)),
                update: updateGroup,
            },
            tabs: {
                get: vi.fn(async tabId => tabs.find(tab => tab.id === tabId)),
                query: vi.fn(async ({ active } = {}) => active
                    ? tabs.filter(tab => tab.active)
                    : tabs),
            },
        };
        const settingsState = {
            awaitReady: vi.fn(async () => {}),
            getRuntime: vi.fn(() => ({
                ...runtimeSettings(2),
                collapseOtherGroupsOnNavEvents: true,
            })),
        };
        const chromeGroups = createChromeGroups({
            chromeApi,
            getManagedPrefix: () => "∑ ",
        });
        const controller = createTabController({ chromeApi, settingsState, chromeGroups });

        chromeGroups.acquireMutationLock(250);
        const handling = controller.handleTabActivated({ tabId: 1, windowId: 10 });
        await vi.advanceTimersByTimeAsync(249);
        expect(updateGroup).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await handling;

        expect(groupsById.get(200).collapsed).toBe(false);
        expect(groupsById.get(300).collapsed).toBe(true);
    });
});
