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

test("ignored tabs neither form nor join managed groups", async ({ context, httpServer, extensionApi }) => {
  const firstUrl = httpServer.url("/ignored-a");
  const secondUrl = httpServer.url("/ignored-b");
  await extensionApi.setStorage({ ignoredHostnames: ["127.0.0.1"] });
  await openHttpPage(context, firstUrl);
  await openHttpPage(context, secondUrl);
  await extensionApi.forceReevaluate();

  await expect.poll(async () => (await extensionApi.tabsByUrls([firstUrl, secondUrl])).map((tab) => tab?.groupId)).toEqual([
    noGroupId,
    noGroupId,
  ]);
});

test("reevaluation removes ignored unpinned tabs from managed groups but preserves user groups", async ({ context, httpServer, extensionApi }) => {
  const managedUrls = [httpServer.url("/managed-a"), httpServer.url("/managed-b")];
  const userUrls = [httpServer.url("/user-a"), httpServer.url("/user-b")];
  for (const url of [...managedUrls, ...userUrls]) await openHttpPage(context, url);
  const userGroup = await extensionApi.createUserGroup(userUrls, "Manual ignored hosts");
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, managedUrls);

  await extensionApi.setStorage({ ignoredHostnames: ["127.0.0.1"] });
  await extensionApi.forceReevaluate();

  await expect.poll(async () => {
    const managedTabs = await extensionApi.tabsByUrls(managedUrls);
    const userTabs = await extensionApi.tabsByUrls(userUrls);
    return {
      managedGroupIds: managedTabs.map((tab) => tab?.groupId),
      userGroupIds: userTabs.map((tab) => tab?.groupId),
      userTitle: (await extensionApi.groupById(userGroup.groupId)).title,
    };
  }).toEqual({
    managedGroupIds: [noGroupId, noGroupId],
    userGroupIds: [userGroup.groupId, userGroup.groupId],
    userTitle: "Manual ignored hosts",
  });
});

test("ignored-host reevaluation bypasses the unified initial-URL exemption", async ({ context, httpServer, extensionApi }) => {
  const urls = [httpServer.url("/initial-managed-a"), httpServer.url("/initial-managed-b")];
  await extensionApi.setStorage({
    ignoreInitialTabUrlForGrouping: false,
    ignoreInitialTabUrlForEnforcement: true,
  });
  for (const url of urls) await openHttpPage(context, url);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, urls);

  await extensionApi.setStorage({ ignoredHostnames: ["127.0.0.1"] });
  await extensionApi.forceReevaluate();

  await expect.poll(async () => (await extensionApi.tabsByUrls(urls)).map((tab) => tab?.groupId)).toEqual([
    noGroupId,
    noGroupId,
  ]);
});
