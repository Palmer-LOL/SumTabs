import { test, expect } from "./fixtures.js";

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
  await initialUrlToggle.check();
  await settingsPage.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(async () => {
    const stored = await extensionApi.getStorage();
    return [stored.ignoreInitialTabUrlForGrouping, stored.ignoreInitialTabUrlForEnforcement];
  }).toEqual([true, true]);
});
