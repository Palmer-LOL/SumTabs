import { test, expect } from "./fixtures.js";

test("loads the unpacked MV3 extension and opens an extension page", async ({ context, extensionId, serviceWorker, extensionPage }) => {
  expect(context.serviceWorkers()).toContain(serviceWorker);
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/background.js`);

  const settingsPage = await extensionPage("settings.html");
  await expect(settingsPage).toHaveURL(`chrome-extension://${extensionId}/settings.html`);
  await expect(settingsPage.getByRole("heading", { name: "SumTabs Settings" })).toBeVisible();
});

test("loads the popup page modules and core controls inside the extension origin", async ({ context, extensionId }) => {
  const pageErrors = [];
  const popupPage = await context.newPage();
  popupPage.on("pageerror", (error) => pageErrors.push(error));
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popupPage).toHaveURL(`chrome-extension://${extensionId}/popup.html`);
  await expect(popupPage.getByRole("heading", { name: "SumTabs" })).toBeVisible();
  await expect(popupPage.getByRole("button", { name: "Open settings" })).toBeVisible();
  await expect(popupPage.getByRole("button", { name: "Reapply rules to open tabs" })).toBeVisible();
  await expect(popupPage.getByRole("status")).toBeAttached();
  await expect(popupPage.getByText("Current tab")).toBeVisible();
  await expect(popupPage.getByText("More actions")).toBeVisible();
  expect(pageErrors, "popup.html should not throw uncaught page errors while loading directly").toEqual([]);
});
