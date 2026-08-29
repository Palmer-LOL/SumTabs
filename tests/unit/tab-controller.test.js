import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabController } from "../../src/background/tab-controller.js";

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
