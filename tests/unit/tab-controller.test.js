import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabController } from "../../src/background/tab-controller.js";

function runtimeSettings(minTabsToGroup) {
    return {
        commonMultipartSuffixes: new Set(),
        excludedFromRootCollapse: new Set(),
        ignoredHostnames: new Set(),
        autoGroupPrefix: "∑ ",
        minTabsToGroup,
        collapseOtherGroupsOnNavEvents: false,
        keepManagedGroupsAtFront: false,
        ungroupSingletonManagedGroups: false,
        ignoreInitialTabUrl: false,
        customBundleMaps: {
            exactHostnameToBundleRules: new Map(),
            rootDomainToBundleRules: new Map(),
        },
        customIdentityToColor: new Map(),
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
    });
});
