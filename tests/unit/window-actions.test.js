import { describe, expect, it, vi } from "vitest";

import { initWindowActions } from "../../src/popup/window-actions.js";

describe("initWindowActions", () => {
  it("uses the injected Chrome API to install its stylesheet", async () => {
    expect(globalThis.chrome).toBeUndefined();

    const getURL = vi.fn(
      (reference) => `chrome-extension://test-extension/${reference}`,
    );
    const appendChild = vi.fn();
    const documentRef = {
      defaultView: {},
      head: { appendChild },
      querySelector: vi.fn(() => null),
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ dataset: {} })),
    };
    const chromeApi = {
      runtime: { getURL },
      tabGroups: { TAB_GROUP_ID_NONE: -1 },
    };

    await initWindowActions({ chromeApi, documentRef });

    expect(getURL).toHaveBeenCalledOnce();
    expect(getURL).toHaveBeenCalledWith("src/popup/window-actions.css");
    expect(appendChild).toHaveBeenCalledOnce();
    expect(appendChild.mock.calls[0][0]).toMatchObject({
      rel: "stylesheet",
      href: "chrome-extension://test-extension/src/popup/window-actions.css",
      dataset: { sumtabsWindowActions: "true" },
    });
  });
});
