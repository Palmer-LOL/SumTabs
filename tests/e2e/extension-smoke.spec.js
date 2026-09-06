import { backgroundPath, popupPath, settingsPath, test, expect } from "./fixtures.js";

test("loads the unpacked MV3 extension and opens an extension page", async ({ context, extensionId, serviceWorker, extensionPage }) => {
  expect(context.serviceWorkers()).toContain(serviceWorker);
  expect(serviceWorker.url()).toBe(`chrome-extension://${extensionId}/${backgroundPath}`);

  const settingsPage = await extensionPage(settingsPath);
  await expect(settingsPage).toHaveURL(`chrome-extension://${extensionId}/${settingsPath}`);
  await expect(settingsPage.getByRole("heading", { name: "SumTabs Settings" })).toBeVisible();
});

test("loads the popup page modules and core controls inside the extension origin", async ({ context, extensionId }) => {
  const pageErrors = [];
  const popupPage = await context.newPage();
  popupPage.on("pageerror", (error) => pageErrors.push(error));
  await popupPage.goto(`chrome-extension://${extensionId}/${popupPath}`);

  await expect(popupPage).toHaveURL(`chrome-extension://${extensionId}/${popupPath}`);
  await expect(popupPage.getByRole("heading", { name: "SumTabs" })).toBeVisible();
  await expect(popupPage.getByRole("button", { name: "Open settings" })).toBeVisible();
  await expect(popupPage.getByRole("button", { name: "Reapply rules to open tabs" })).toBeVisible();
  await expect(popupPage.getByRole("status")).toBeAttached();
  await expect(popupPage.getByText("Current tab", { exact: true })).toBeVisible();
  await expect(popupPage.getByText("Current window", { exact: true })).toBeVisible();
  await expect(popupPage.getByText("More actions", { exact: true })).toBeVisible();
  await expect(popupPage.getByRole("checkbox", { name: "Ignore this hostname", includeHidden: true })).toBeAttached();

  const sectionIds = await popupPage
    .locator(".popup__sections > .popup__section")
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(sectionIds.slice(0, 2)).toEqual(["statusCard", "windowSummarySection"]);

  const currentWindowSection = popupPage.locator("#windowSummarySection");
  const moreActionsSection = popupPage.locator("#windowActionsSection");
  await expect(currentWindowSection.locator(".popup__window-summary")).toBeAttached();
  await expect(moreActionsSection.locator(".popup__window-summary")).toHaveCount(0);
  await moreActionsSection.locator("summary").click();
  const closeAllUnpinnedTabs = moreActionsSection.locator("#closeAllUnpinnedTabs");
  await expect(closeAllUnpinnedTabs).toBeVisible();
  await expect(closeAllUnpinnedTabs).toHaveAccessibleName(
    /^(?:Close all \d+ unpinned tabs?|No unpinned tabs to close)$/,
  );
  expect(pageErrors, "popup page should not throw uncaught page errors while loading directly").toEqual([]);
});
