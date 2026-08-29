import { describe, expect, it, vi } from "vitest";
import { createSettingsState } from "../../src/background/settings-state.js";
import { DEFAULTS } from "../../src/core/defaults.js";

function createHarness(storedOverrides = {}) {
    const stored = {
        ...structuredClone(DEFAULTS),
        ...structuredClone(storedOverrides),
    };
    const chromeApi = {
        storage: {
            sync: {
                get: vi.fn(async () => structuredClone(stored)),
                set: vi.fn(async () => {}),
            },
        },
    };
    const navigatorRef = {
        locks: {
            request: vi.fn(async (_name, callback) => callback()),
        },
    };
    const state = createSettingsState({ chromeApi, navigatorRef, defaults: DEFAULTS });

    return { chromeApi, state, stored };
}

describe("background settings state", () => {
    it("returns one frozen scalar-only runtime snapshot until settings change", async () => {
        const { state } = createHarness();
        await state.startInitialLoad();

        const first = state.getRuntime();
        const second = state.getRuntime();

        expect(second).toBe(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(first).toEqual({
            autoGroupPrefix: "∑ ",
            minTabsToGroup: 2,
            collapseOtherGroupsOnNavEvents: true,
            keepManagedGroupsAtFront: true,
            ungroupSingletonManagedGroups: false,
            ignoreInitialTabUrl: true,
        });
        expect(Object.values(first).some(value => value instanceof Map || value instanceof Set)).toBe(false);
    });

    it("atomically replaces the snapshot after a storage change without mutating old snapshots", async () => {
        const { state, stored } = createHarness();
        await state.startInitialLoad();
        const oldSnapshot = state.getRuntime();

        state.handleStorageChange(
            {
                minTabsToGroup: { newValue: 4 },
                collapseOtherGroupsOnNavEvents: { newValue: false },
            },
            "sync",
            vi.fn(async () => {}),
        );
        const newSnapshot = state.getRuntime();

        expect(newSnapshot).not.toBe(oldSnapshot);
        expect(newSnapshot.minTabsToGroup).toBe(4);
        expect(newSnapshot.collapseOtherGroupsOnNavEvents).toBe(false);
        expect(oldSnapshot.minTabsToGroup).toBe(2);
        expect(oldSnapshot.collapseOtherGroupsOnNavEvents).toBe(true);

        stored.minTabsToGroup = 5;
        await state.reload();
        const reloadedSnapshot = state.getRuntime();
        expect(reloadedSnapshot).not.toBe(newSnapshot);
        expect(reloadedSnapshot.minTabsToGroup).toBe(5);
        expect(newSnapshot.minTabsToGroup).toBe(4);
    });

    it("keeps ignored, custom-bundle, and root-domain grouping data private", async () => {
        const { state } = createHarness({
            ignoredHostnames: ["ignored.example"],
            customDomainGroups: [
                {
                    title: "Work",
                    domains: ["example.com/projects"],
                    color: "purple",
                },
            ],
        });
        await state.startInitialLoad();

        expect(state.resolveGroupingForUrl(new URL("https://ignored.example/path"))).toBeNull();
        expect(state.resolveGroupingForUrl(new URL("https://example.com/projects/one"))).toMatchObject({
            identity: "∑ Work",
            reason: "custom-bundle-grouping",
        });
        expect(state.resolveGroupingForUrl(new URL("https://docs.example.com/projects/two"))).toMatchObject({
            identity: "∑ Work",
            reason: "custom-bundle-grouping",
        });
        expect(state.resolveGroupingForUrl(new URL("https://docs.example.net/"))).toMatchObject({
            identity: "∑ example.net",
            groupKey: "example.net",
        });
    });

    it("looks up valid custom identity colors without exposing the color map", async () => {
        const { state } = createHarness({
            customDomainGroups: [
                { title: "Work", domains: ["example.com"], color: "purple" },
                { title: "Invalid", domains: ["invalid.example"], color: "chartreuse" },
            ],
        });
        await state.startInitialLoad();

        expect(state.getCustomIdentityColor("∑ Work")).toBe("purple");
        expect(state.getCustomIdentityColor("∑ Invalid")).toBeUndefined();
        expect(state.getCustomIdentityColor("∑ Missing")).toBeUndefined();
        expect(state.getRuntime()).not.toHaveProperty("customIdentityToColor");
    });
});
