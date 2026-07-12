import { test, expect } from "./fixtures.js";

test.beforeEach(async ({ extensionApi }) => {
  await extensionApi.resetStorage();
});

test("saves grouping threshold through the real settings UI and persists it in sync storage", async ({ extensionPage, extensionApi }) => {
  const settingsPage = await extensionPage("settings.html");

  await expect(settingsPage.getByRole("heading", { name: "SumTabs Settings" })).toBeVisible();
  await expect(settingsPage.getByRole("status").filter({ hasText: "No unsaved changes." })).toBeVisible();

  await settingsPage.getByText("Grouping behavior").click();
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
  await settingsPage.getByText("Grouping behavior").click();
  await expect(settingsPage.getByLabel("Group when at least this many matching tabs exist")).toHaveValue("3");
});
