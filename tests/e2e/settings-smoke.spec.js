import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ extensionApi }) => {
  await extensionApi.resetStorage();
});

test("saves grouping threshold through the real settings UI and persists it in sync storage", async ({ extensionPage, extensionApi }) => {
  const settingsPage = await extensionPage("settings.html");

  await expect(settingsPage.getByRole("heading", { name: "SumTabs Settings" })).toBeVisible();
  await expect(settingsPage.getByRole("status").filter({ hasText: "No unsaved changes." })).toBeVisible();

  const threshold = settingsPage.getByLabel("Group when at least this many matching tabs exist");
  await expect(threshold).toHaveValue("2");
  await threshold.fill("3");

  await expect(settingsPage.getByRole("status").filter({ hasText: "Unsaved changes." })).toBeVisible();
  await settingsPage.getByRole("button", { name: "Save changes" }).click();
  await expect(settingsPage.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();

  await expect.poll(async () => (await extensionApi.getStorage()).minTabsToGroup, {
    message: "settings UI should persist minTabsToGroup to chrome.storage.sync",
  }).toBe(3);

  await settingsPage.reload();
  await expect(settingsPage.getByLabel("Group when at least this many matching tabs exist")).toHaveValue("3");
});

test("discards editor changes without replacing saved settings", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ minTabsToGroup: 3 });
  const settingsPage = await extensionPage("settings.html");
  const threshold = settingsPage.getByLabel("Group when at least this many matching tabs exist");

  await threshold.fill("4");
  await settingsPage.getByRole("button", { name: "Discard changes" }).click();

  await expect(threshold).toHaveValue("3");
  await expect(settingsPage.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect.poll(async () => (await extensionApi.getStorage()).minTabsToGroup).toBe(3);
});

test("exports synchronized settings and imports a backup", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ minTabsToGroup: 3, futureSetting: { retained: true } });
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Advanced behavior").click();

  const downloadPromise = settingsPage.waitForEvent("download");
  await settingsPage.getByRole("button", { name: "Export settings" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^sumtabs-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported).toMatchObject({
    format: "sumtabs-settings",
    version: 1,
    settings: {
      autoGroupPrefix: "∑ ",
      minTabsToGroup: 3,
      futureSetting: { retained: true },
    },
  });

  const imported = structuredClone(exported);
  imported.settings.minTabsToGroup = 4;
  imported.settings.customDomainGroups = [{ title: "Restored", domains: ["example.com", "example.org"] }];
  settingsPage.once("dialog", (dialog) => dialog.accept());
  await settingsPage.locator("#importSettingsFile").setInputFiles({
    name: "sumtabs-settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });

  await expect(settingsPage.getByRole("status").filter({ hasText: "Settings imported." })).toBeVisible();
  await expect(settingsPage.getByLabel("Group when at least this many matching tabs exist")).toHaveValue("4");
  await expect.poll(async () => await extensionApi.getStorage()).toMatchObject({
    minTabsToGroup: 4,
    futureSetting: { retained: true },
    customDomainGroups: [{ title: "Restored", domains: ["example.com", "example.org"] }],
  });
});

test("rejects malformed imported settings before writing to sync storage", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ minTabsToGroup: 3, futureSetting: { retained: true } });
  const settingsPage = await extensionPage("settings.html");
  const malformed = {
    format: "sumtabs-settings",
    version: 1,
    settings: {
      ...structuredClone((await extensionApi.getStorage())),
      autoGroupPrefix: "∑ ",
      collapseOtherGroupsOnNavEvents: true,
      keepManagedGroupsAtFront: true,
      ungroupSingletonManagedGroups: false,
      ignoreInitialTabUrlForGrouping: true,
      ignoreInitialTabUrlForEnforcement: true,
      commonMultipartSuffixes: "co.uk",
      excludedFromRootCollapse: [],
      ignoredHostnames: [],
      customDomainGroups: [],
    },
  };

  await settingsPage.locator("#importSettingsFile").setInputFiles({
    name: "malformed-sumtabs-settings.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(malformed)),
  });

  await expect(settingsPage.getByRole("status").filter({ hasText: "must be an array of hostnames" })).toBeVisible();
  expect(await extensionApi.getStorage()).toEqual({ minTabsToGroup: 3, futureSetting: { retained: true } });
});

test("saves and reloads canonical ignored hostnames through sync storage", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ futureSetting: { retained: true } });
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Site separation rules").click();

  const ignored = settingsPage.getByLabel("Ignore these specific hostnames");
  await ignored.fill(" Docs.Example.COM \nmail.example.com\ndocs.example.com");
  await settingsPage.getByRole("button", { name: "Save changes" }).click();
  await expect(settingsPage.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();

  await expect.poll(async () => (await extensionApi.getStorage()).ignoredHostnames).toEqual([
    "docs.example.com",
    "mail.example.com",
  ]);
  expect((await extensionApi.getStorage()).futureSetting).toEqual({ retained: true });

  await settingsPage.reload();
  await settingsPage.getByText("Site separation rules").click();
  await expect(ignored).toHaveValue("docs.example.com\nmail.example.com");
});

test("uses one initial-URL toggle and keeps both legacy storage keys aligned", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({
    ignoreInitialTabUrlForGrouping: true,
    ignoreInitialTabUrlForEnforcement: false,
  });
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Advanced behavior").click();

  const initialUrlToggle = settingsPage.getByLabel("Ignore a tab’s initial URL while grouping and enforcing placement");
  await expect(initialUrlToggle).not.toBeChecked();
  await settingsPage.getByLabel("Group when at least this many matching tabs exist").fill("3");
  await settingsPage.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(async () => {
    const stored = await extensionApi.getStorage();
    return [stored.ignoreInitialTabUrlForGrouping, stored.ignoreInitialTabUrlForEnforcement];
  }).toEqual([false, false]);
});

test("preserves an unsaved bundle draft while a clean ignore list updates live", async ({ extensionPage, extensionApi }) => {
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Custom bundles", { exact: true }).click();
  await settingsPage.getByRole("button", { name: "Create bundle" }).click();
  await settingsPage.getByLabel("Bundle title").fill("Unsaved research");
  await settingsPage.getByLabel("Domain rules").fill("example.com\nexample.org");

  await extensionApi.setStorage({ ignoredHostnames: ["popup.example"] });

  await settingsPage.getByText("Site separation rules").click();
  await expect(settingsPage.getByLabel("Ignore these specific hostnames")).toHaveValue("popup.example");
  await expect(settingsPage.getByLabel("Bundle title")).toHaveValue("Unsaved research");
  await expect(settingsPage.getByLabel("Domain rules")).toHaveValue("example.com\nexample.org");

  await settingsPage.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => await extensionApi.getStorage()).toMatchObject({
    ignoredHostnames: ["popup.example"],
    customDomainGroups: [{ title: "Unsaved research", domains: ["example.com", "example.org"] }],
  });
});

test("requires an explicit choice for simultaneous local and external ignore-list edits", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ ignoredHostnames: ["original.example"] });
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Site separation rules").click();
  const ignored = settingsPage.getByLabel("Ignore these specific hostnames");
  const save = settingsPage.getByRole("button", { name: "Save changes" });

  await ignored.fill("my-draft.example");
  await extensionApi.setStorage({ ignoredHostnames: ["popup.example"] });
  await expect(settingsPage.getByRole("alert")).toContainText("stored ignore list changed");
  await expect(ignored).toHaveValue("my-draft.example");
  await expect(save).toBeDisabled();

  await extensionApi.setStorage({ ignoredHostnames: ["original.example"] });
  await expect(settingsPage.getByRole("alert")).toBeHidden();
  await expect(ignored).toHaveValue("my-draft.example");
  await expect(save).toBeEnabled();

  await extensionApi.setStorage({ ignoredHostnames: ["popup.example"] });
  await expect(settingsPage.getByRole("alert")).toContainText("stored ignore list changed");
  await expect(save).toBeDisabled();

  await settingsPage.getByRole("button", { name: "Use current stored value" }).click();
  await expect(ignored).toHaveValue("popup.example");
  await expect(settingsPage.getByRole("alert")).toBeHidden();

  await ignored.fill("second-draft.example");
  await extensionApi.setStorage({ ignoredHostnames: ["newer-popup.example"] });
  await expect(save).toBeDisabled();
  await settingsPage.getByRole("button", { name: "Keep my draft" }).click();
  await expect(ignored).toHaveValue("second-draft.example");
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(async () => (await extensionApi.getStorage()).ignoredHostnames).toEqual(["second-draft.example"]);
});

test("treats loading defaults as an explicit resolution of an ignore-list conflict", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ ignoredHostnames: ["original.example"] });
  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Site separation rules").click();
  await settingsPage.getByLabel("Ignore these specific hostnames").fill("draft.example");
  await extensionApi.setStorage({ ignoredHostnames: ["external.example"] });
  await expect(settingsPage.getByRole("alert")).toBeVisible();

  settingsPage.once("dialog", (dialog) => dialog.accept());
  await settingsPage.getByText("Advanced behavior").click();
  await settingsPage.getByRole("button", { name: "Load default settings" }).click();

  await expect(settingsPage.getByRole("alert")).toBeHidden();
  await expect(settingsPage.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await settingsPage.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await extensionApi.getStorage()).ignoredHostnames).toEqual([]);
});

test("coordinates the final conflict check and write with popup ignore updates", async ({ extensionPage, extensionApi }) => {
  await extensionApi.setStorage({ ignoredHostnames: ["original.example"] });
  const settingsPage = await extensionPage("settings.html");
  const popupWriter = await extensionPage("settings.html");
  await settingsPage.getByText("Site separation rules").click();
  await settingsPage.getByLabel("Ignore these specific hostnames").fill("settings-draft.example");

  await popupWriter.evaluate(() => {
    globalThis.popupLockAcquired = false;
    globalThis.popupLockTask = navigator.locks.request("sumtabs:ignored-hostnames-storage", async () => {
      globalThis.popupLockAcquired = true;
      await new Promise((resolve) => { globalThis.releasePopupLock = resolve; });
      await chrome.storage.sync.set({ ignoredHostnames: ["popup.example"] });
    });
  });
  await expect.poll(() => popupWriter.evaluate(() => globalThis.popupLockAcquired)).toBe(true);

  await settingsPage.getByRole("button", { name: "Save changes" }).click();
  await popupWriter.evaluate(() => globalThis.releasePopupLock());

  await expect(settingsPage.getByRole("alert")).toContainText("stored ignore list changed");
  await expect(settingsPage.getByLabel("Ignore these specific hostnames")).toHaveValue("settings-draft.example");
  await expect.poll(async () => (await extensionApi.getStorage()).ignoredHostnames).toEqual(["popup.example"]);
  await popupWriter.close();
});

test("serializes a real popup ignore toggle behind a Settings save", async ({ context, httpServer, extensionPage, extensionApi }) => {
  const storageLock = "sumtabs:ignored-hostnames-storage";
  const targetUrl = httpServer.url("/popup-settings-lock-race");
  const targetHostname = new URL(targetUrl).hostname;
  await extensionApi.setStorage({ ignoredHostnames: ["original.example"] });
  const targetPage = await context.newPage();
  await targetPage.goto(targetUrl);

  const settingsPage = await extensionPage("settings.html");
  await settingsPage.getByText("Site separation rules").click();
  await settingsPage.getByLabel("Ignore these specific hostnames").fill("settings-draft.example");

  const popupPage = await extensionPage("popup.html");
  await extensionApi.evaluate(`
    const targetUrl = ${JSON.stringify(targetUrl)};
    const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {});
    const targetTab = tabs.find((tab) => tab.url === targetUrl);
    if (!targetTab) throw new Error("Target tab not found");
    await callbackify(chrome.tabs.update.bind(chrome.tabs), targetTab.id, { active: true });
    return true;
  `);
  await popupPage.reload();
  await expect(popupPage.locator("#activeHostname")).toHaveText(targetHostname);
  await popupPage.getByText("Change how this site is handled").click();
  const popupIgnoreToggle = popupPage.getByRole("checkbox", { name: `Ignore ${targetHostname}` });
  await expect(popupIgnoreToggle).toBeVisible();

  await settingsPage.evaluate((lockName) => {
    globalThis.releaseIgnoredHostnamesTestLock = null;
    globalThis.ignoredHostnamesTestLockHeld = false;
    globalThis.ignoredHostnamesTestLock = navigator.locks.request(lockName, async () => {
      globalThis.ignoredHostnamesTestLockHeld = true;
      await new Promise((resolve) => { globalThis.releaseIgnoredHostnamesTestLock = resolve; });
    });
  }, storageLock);
  await expect.poll(() => settingsPage.evaluate(() => globalThis.ignoredHostnamesTestLockHeld)).toBe(true);

  try {
    await settingsPage.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => settingsPage.evaluate(async (lockName) => {
      const snapshot = await navigator.locks.query();
      return snapshot.pending.filter((lock) => lock.name === lockName).length;
    }, storageLock)).toBeGreaterThanOrEqual(1);

    await popupIgnoreToggle.check();
    await expect.poll(async () => {
      const stored = await extensionApi.getStorage();
      const lockState = await settingsPage.evaluate(async (lockName) => {
        const snapshot = await navigator.locks.query();
        return snapshot.pending.filter((lock) => lock.name === lockName).length;
      }, storageLock);
      return stored.ignoredHostnames?.includes(targetHostname) || lockState >= 2;
    }).toBe(true);
  } finally {
    await settingsPage.evaluate(() => globalThis.releaseIgnoredHostnamesTestLock?.());
  }

  await expect.poll(async () => (await extensionApi.getStorage()).ignoredHostnames).toEqual([
    "settings-draft.example",
    targetHostname,
  ]);
  await expect(popupPage.locator("#popupFeedback")).toContainText("Hostname ignored. Open tabs have been reorganized.");
});
