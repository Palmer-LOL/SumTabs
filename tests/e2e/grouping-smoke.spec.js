import { test, expect, managedPrefix, noGroupId, openHttpPage, expectTabsGrouped } from "./fixtures.js";

test.beforeEach(async ({ extensionApi }) => {
  await extensionApi.resetStorage();
});

test("groups two matching HTTP tabs through real Chromium tab APIs", async ({ context, httpServer, extensionApi }) => {
  const firstInitialUrl = httpServer.url("/initial-tab-a");
  const secondInitialUrl = httpServer.url("/initial-tab-b");
  const firstUrl = httpServer.url("/tab-a");
  const secondUrl = httpServer.url("/tab-b");

  const firstPage = await openHttpPage(context, firstInitialUrl);
  await firstPage.goto(firstUrl);
  await expect.poll(async () => (await extensionApi.tabByUrl(firstUrl))?.groupId ?? noGroupId, {
    message: "a single eligible HTTP tab should remain ungrouped",
  }).toBe(noGroupId);

  const secondPage = await openHttpPage(context, secondInitialUrl);
  await secondPage.goto(secondUrl);
  await extensionApi.forceReevaluate();

  await expectTabsGrouped(extensionApi, [firstUrl, secondUrl]);
  const [firstTab] = await extensionApi.tabsByUrls([firstUrl]);
  const group = await extensionApi.groupById(firstTab.groupId);
  expect(group.title).toBe(`${managedPrefix}127.0.0.1`);
});

test("leaves a matching pinned tab untouched while grouping unpinned tabs", async ({ context, httpServer, extensionApi }) => {
  const pinnedUrl = httpServer.url("/pinned");
  const firstInitialUrl = httpServer.url("/initial-unpinned-a");
  const secondInitialUrl = httpServer.url("/initial-unpinned-b");
  const firstUrl = httpServer.url("/unpinned-a");
  const secondUrl = httpServer.url("/unpinned-b");

  await openHttpPage(context, pinnedUrl);
  await extensionApi.pinTabByUrl(pinnedUrl);
  const firstPage = await openHttpPage(context, firstInitialUrl);
  await firstPage.goto(firstUrl);
  const secondPage = await openHttpPage(context, secondInitialUrl);
  await secondPage.goto(secondUrl);
  await extensionApi.forceReevaluate();

  await expectTabsGrouped(extensionApi, [firstUrl, secondUrl]);
  await expect.poll(async () => {
    const pinnedTab = await extensionApi.tabByUrl(pinnedUrl);
    return { pinned: pinnedTab?.pinned, groupId: pinnedTab?.groupId };
  }, { message: "the matching pinned tab should remain pinned and outside every tab group" }).toEqual({ pinned: true, groupId: noGroupId });
});

test("preserves a user-created non-managed group during reevaluation", async ({ context, httpServer, extensionApi }) => {
  const firstUrl = httpServer.url("/manual-group-a");
  const secondUrl = httpServer.url("/manual-group-b");
  const title = "Manual research group";

  await openHttpPage(context, firstUrl);
  await openHttpPage(context, secondUrl);
  const created = await extensionApi.createUserGroup([firstUrl, secondUrl], title);

  await extensionApi.forceReevaluate();

  await expect.poll(async () => {
    const tabs = await extensionApi.tabsByUrls([firstUrl, secondUrl]);
    const group = await extensionApi.groupById(created.groupId);
    return {
      title: group.title,
      sameGroup: tabs.every((tab) => tab?.groupId === created.groupId),
      tabIds: tabs.map((tab) => tab?.id).sort((a, b) => a - b),
    };
  }, { message: "SumTabs should not rename, dissolve, replace, or commandeer a user-created group" }).toEqual({
    title,
    sameGroup: true,
    tabIds: created.tabs.map((tab) => tab.id).sort((a, b) => a - b),
  });
});
