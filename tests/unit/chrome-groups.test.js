import { describe, expect, it, vi } from "vitest";
import { createChromeGroups } from "../../src/background/chrome-groups.js";

describe("chrome group collapse guard", () => {
    it("skips matching collapse state and fresh-checks managed ownership before each mutation", async () => {
        const group = { id: 200, title: "∑ managed.test", collapsed: true };
        const update = vi.fn(async (_groupId, changes) => {
            Object.assign(group, changes);
            return group;
        });
        const chromeApi = {
            tabGroups: {
                TAB_GROUP_ID_NONE: -1,
                get: vi.fn(async () => ({ ...group })),
                update,
            },
        };
        const chromeGroups = createChromeGroups({
            chromeApi,
            getManagedPrefix: () => "∑ ",
        });

        expect(await chromeGroups.setGroupCollapsed(200, true)).toBe(false);
        expect(update).not.toHaveBeenCalled();

        group.collapsed = false;
        expect(await chromeGroups.setGroupCollapsed(200, true)).toBe(true);
        expect(update).toHaveBeenCalledOnce();
        expect(update).toHaveBeenCalledWith(200, { collapsed: true });

        group.title = "Personal group";
        group.collapsed = false;
        expect(await chromeGroups.setGroupCollapsed(200, true)).toBe(false);
        expect(update).toHaveBeenCalledOnce();
        expect(chromeApi.tabGroups.get).toHaveBeenCalledTimes(3);
    });
});
