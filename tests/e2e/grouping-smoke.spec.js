import { test, expect, managedPrefix, noGroupId, openHttpPage, expectTabsGrouped, settingsPath } from "./fixtures.js";

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

test("focus mode collapses managed groups without changing an active user-created group", async ({ context, httpServer, extensionApi, extensionPage }) => {
  const managedUrls = [httpServer.url("/focus-managed-a"), httpServer.url("/focus-managed-b")];
  const userUrls = [httpServer.url("/focus-user-a"), httpServer.url("/focus-user-b")];
  const userTitle = "Manual focus group";

  await extensionApi.setStorage({ collapseOtherGroupsOnNavEvents: true });
  for (const url of [...managedUrls, ...userUrls]) await openHttpPage(context, url);
  const userGroup = await extensionApi.createUserGroup(userUrls, userTitle);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, managedUrls);

  const [managedTab] = await extensionApi.tabsByUrls([managedUrls[0]]);
  const managedGroupId = managedTab.groupId;
  const settingsPage = await extensionPage(settingsPath);
  await extensionApi.setGroupCollapsed(managedGroupId, false);
  await extensionApi.setGroupCollapsed(userGroup.groupId, false);
  await extensionApi.evaluate(`const targetUrl = ${JSON.stringify(userUrls[0])}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); const tab = tabs.find((candidate) => candidate.url === targetUrl); if (!tab) throw new Error('Tab not found for activation'); await callbackify(chrome.tabs.update.bind(chrome.tabs), tab.id, { active: true }); return true;`);

  await expect.poll(async () => (await extensionApi.groupById(managedGroupId)).collapsed, {
    message: "activation should finish collapsing the managed group before the forced-reevaluation prerequisite is reset",
  }).toBe(true);
  await extensionApi.setGroupCollapsed(managedGroupId, false);
  await expect.poll(async () => (await extensionApi.groupById(managedGroupId)).collapsed, {
    message: "the managed group should be confirmed expanded before forced reevaluation",
  }).toBe(false);
  await expect.poll(async () => (await extensionApi.tabByUrl(userUrls[0]))?.active, {
    message: "the intended user-created-group tab should be active immediately before forced reevaluation",
  }).toBe(true);
  const response = await settingsPage.evaluate((message) => chrome.runtime.sendMessage(message), {
    type: "sumtabs:force-reevaluate",
  });
  expect(response).toEqual({ ok: true });

  await expect.poll(async () => {
    const [managedGroup, refreshedUserGroup, userGroupTabs] = await Promise.all([
      extensionApi.groupById(managedGroupId),
      extensionApi.groupById(userGroup.groupId),
      extensionApi.evaluate(`return await callbackify(chrome.tabs.query.bind(chrome.tabs), { groupId: ${userGroup.groupId} });`),
    ]);
    return {
      managedCollapsed: managedGroup.collapsed,
      userCollapsed: refreshedUserGroup.collapsed,
      userTitle: refreshedUserGroup.title,
      userTabIds: userGroupTabs.map((tab) => tab.id).sort((a, b) => a - b),
    };
  }, { message: "focus mode should collapse managed groups while leaving the active user-created group untouched" }).toEqual({
    managedCollapsed: true,
    userCollapsed: false,
    userTitle,
    userTabIds: userGroup.tabs.map((tab) => tab.id).sort((a, b) => a - b),
  });
});

test("ignored tabs neither form nor join managed groups", async ({ context, httpServer, extensionApi }) => {
  const firstUrl = httpServer.url("/ignored-a");
  const secondUrl = httpServer.url("/ignored-b");
  await extensionApi.updateIgnoredHostname("127.0.0.1", true);
  await openHttpPage(context, firstUrl);
  await openHttpPage(context, secondUrl);
  const createdTabs = await extensionApi.forceReevaluateTrackingCreatedTabs();

  await expect.poll(async () => (await extensionApi.tabsByUrls([firstUrl, secondUrl])).map((tab) => tab?.groupId)).toEqual([
    noGroupId,
    noGroupId,
  ]);
  expect(createdTabs, "a no-op reevaluation should not create a transient about:blank render-workaround tab")
    .not.toContainEqual(expect.objectContaining({ url: "about:blank" }));
});

for (const activePosition of ["first", "middle", "last"]) {
  test(`reevaluation preserves the ${activePosition} active tab while newly grouping ignored tabs`, async ({ context, httpServer, extensionApi }) => {
    const urls = [
      httpServer.url(`/active-preservation-${activePosition}-a`),
      httpServer.url(`/active-preservation-${activePosition}-b`),
      httpServer.url(`/active-preservation-${activePosition}-c`),
    ];
    const activeIndex = { first: 0, middle: 1, last: 2 }[activePosition];

    await extensionApi.setStorage({ ignoredHostnames: ["127.0.0.1"] });
    for (const url of urls) await openHttpPage(context, url);
    await extensionApi.setStorage({ ignoredHostnames: [] });
    await extensionApi.forceReevaluateWithActiveTab(urls[activeIndex]);

    await expectTabsGrouped(extensionApi, urls);
    await expect.poll(async () => (await extensionApi.tabByUrl(urls[activeIndex]))?.active, {
      message: `the originally active ${activePosition} tab should remain active after forced grouping`,
    }).toBe(true);
  });
}

test("reevaluation removes ignored unpinned tabs from managed groups but preserves user groups", async ({ context, httpServer, extensionApi }) => {
  const managedUrls = [httpServer.url("/managed-a"), httpServer.url("/managed-b")];
  const userUrls = [httpServer.url("/user-a"), httpServer.url("/user-b")];
  for (const url of [...managedUrls, ...userUrls]) await openHttpPage(context, url);
  const userGroup = await extensionApi.createUserGroup(userUrls, "Manual ignored hosts");
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, managedUrls);

  const response = await extensionApi.updateIgnoredHostname("127.0.0.1", true);
  expect(response).toEqual({ ok: true });

  const managedTabs = await extensionApi.tabsByUrls(managedUrls);
  const userTabs = await extensionApi.tabsByUrls(userUrls);
  expect({
    managedGroupIds: managedTabs.map((tab) => tab?.groupId),
    userGroupIds: userTabs.map((tab) => tab?.groupId),
    userTitle: (await extensionApi.groupById(userGroup.groupId)).title,
  }, "the update acknowledgement should wait for strict membership enforcement").toEqual({
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

test("returning to an ignored initial URL removes it and cleans up its managed singleton", async ({ context, httpServer, extensionApi }) => {
  const initialUrl = httpServer.url("/ignored-initial").replace("127.0.0.1", "localhost");
  const groupedUrl = httpServer.url("/grouped-after-initial");
  const companionUrl = httpServer.url("/grouped-companion");
  await extensionApi.setStorage({
    ignoredHostnames: ["localhost"],
    ungroupSingletonManagedGroups: true,
  });

  const returningPage = await openHttpPage(context, initialUrl);
  await returningPage.goto(groupedUrl);
  const companionPage = await openHttpPage(context, httpServer.url("/companion-initial").replace("127.0.0.1", "localhost"));
  await companionPage.goto(companionUrl);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, [groupedUrl, companionUrl]);

  // Let the extension's short mutation lock expire before exercising a user navigation event.
  await returningPage.waitForTimeout(400);
  await returningPage.goto(initialUrl);

  await expect.poll(async () => (await extensionApi.tabsByUrls([initialUrl, companionUrl])).map((tab) => tab?.groupId ?? noGroupId), {
    message: "the ignored tab should leave its managed group and the remaining singleton should be cleaned up",
  }).toEqual([noGroupId, noGroupId]);
});

test("active ignored navigation collapses the remaining managed group", async ({ context, httpServer, extensionApi }) => {
  const groupedUrl = httpServer.url("/collapse-source");
  const companionUrl = httpServer.url("/collapse-companion");
  const ignoredUrl = httpServer.url("/collapse-ignored").replace("127.0.0.1", "localhost");
  await extensionApi.setStorage({
    collapseOtherGroupsOnNavEvents: true,
    ignoredHostnames: ["localhost"],
    ungroupSingletonManagedGroups: false,
  });

  const navigatingPage = await openHttpPage(context, groupedUrl);
  await openHttpPage(context, companionUrl);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, [groupedUrl, companionUrl]);

  const sourceGroupId = (await extensionApi.tabByUrl(groupedUrl)).groupId;
  await extensionApi.setGroupCollapsed(sourceGroupId, false);
  await navigatingPage.bringToFront();
  await expect.poll(async () => (await extensionApi.tabByUrl(groupedUrl))?.active, {
    message: "the tab exercising active-navigation focus semantics should be active",
  }).toBe(true);
  await navigatingPage.waitForTimeout(400);
  await navigatingPage.goto(ignoredUrl);

  await expect.poll(async () => {
    const ignoredTab = await extensionApi.tabByUrl(ignoredUrl);
    const companionTab = await extensionApi.tabByUrl(companionUrl);
    const group = companionTab?.groupId === noGroupId
      ? null
      : await extensionApi.groupById(companionTab.groupId);
    return {
      ignoredGroupId: ignoredTab?.groupId ?? noGroupId,
      companionGroupId: companionTab?.groupId ?? noGroupId,
      collapsed: group?.collapsed ?? false,
    };
  }, { message: "ignored navigation should still run the configured collapse tail" }).toEqual({
    ignoredGroupId: noGroupId,
    companionGroupId: sourceGroupId,
    collapsed: true,
  });
});

test("background ignored navigation keeps the active managed group expanded", async ({ context, httpServer, extensionApi }) => {
  const backgroundUrl = httpServer.url("/background-collapse-source");
  const activeUrl = httpServer.url("/background-collapse-companion");
  const ignoredUrl = httpServer.url("/background-collapse-ignored").replace("127.0.0.1", "localhost");
  await extensionApi.setStorage({
    collapseOtherGroupsOnNavEvents: true,
    ignoredHostnames: ["localhost"],
    ungroupSingletonManagedGroups: false,
  });

  const backgroundPage = await openHttpPage(context, backgroundUrl);
  const activePage = await openHttpPage(context, activeUrl);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, [backgroundUrl, activeUrl]);

  const managedGroupId = (await extensionApi.tabByUrl(activeUrl)).groupId;
  await extensionApi.setGroupCollapsed(managedGroupId, false);
  await activePage.bringToFront();
  await expect.poll(async () => (await extensionApi.tabByUrl(activeUrl))?.active, {
    message: "the managed companion should be active before the background navigation",
  }).toBe(true);
  await backgroundPage.waitForTimeout(400);
  await backgroundPage.goto(ignoredUrl);

  await expect.poll(async () => {
    const ignoredTab = await extensionApi.tabByUrl(ignoredUrl);
    const activeTab = await extensionApi.tabByUrl(activeUrl);
    const group = activeTab?.groupId === noGroupId
      ? null
      : await extensionApi.groupById(activeTab.groupId);
    return {
      ignoredGroupId: ignoredTab?.groupId ?? noGroupId,
      activeGroupId: activeTab?.groupId ?? noGroupId,
      active: activeTab?.active ?? false,
      collapsed: group?.collapsed ?? false,
    };
  }, { message: "background navigation should not override the active managed-group focus state" }).toEqual({
    ignoredGroupId: noGroupId,
    activeGroupId: managedGroupId,
    active: true,
    collapsed: false,
  });
});

test("a tab returning from an ignored hostname to the same eligible URL regroups", async ({ context, httpServer, extensionApi }) => {
  const eligibleUrl = httpServer.url("/same-url-return");
  const companionUrl = httpServer.url("/same-url-companion");
  const ignoredUrl = httpServer.url("/same-url-ignored").replace("127.0.0.1", "localhost");
  await extensionApi.setStorage({
    ignoreInitialTabUrlForGrouping: false,
    ignoredHostnames: ["localhost"],
  });

  const returningPage = await openHttpPage(context, eligibleUrl);
  await openHttpPage(context, companionUrl);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, [eligibleUrl, companionUrl]);

  await returningPage.waitForTimeout(400);
  await returningPage.goto(ignoredUrl);
  await expect.poll(async () => (await extensionApi.tabByUrl(ignoredUrl))?.groupId ?? noGroupId, {
    message: "the ignored URL should leave the managed group before the return navigation",
  }).toBe(noGroupId);

  // The eligible return must be a distinct user navigation after the normal
  // per-tab debounce window, not a test-only burst of lifecycle events.
  await returningPage.waitForTimeout(800);
  await returningPage.goto(eligibleUrl);
  await expectTabsGrouped(extensionApi, [eligibleUrl, companionUrl]);
});

test("creating an ignored initial URL inside a managed group removes it immediately", async ({ context, httpServer, extensionApi }) => {
  const managedUrls = [httpServer.url("/managed-opener-a"), httpServer.url("/managed-opener-b")];
  const ignoredUrl = httpServer.url("/ignored-group-child").replace("127.0.0.1", "localhost");
  await extensionApi.setStorage({
    ignoreInitialTabUrlForGrouping: true,
    ignoredHostnames: ["localhost"],
  });

  const openerPage = await openHttpPage(context, managedUrls[0]);
  await openHttpPage(context, managedUrls[1]);
  await extensionApi.forceReevaluate();
  await expectTabsGrouped(extensionApi, managedUrls);

  const childPagePromise = context.waitForEvent("page");
  await openerPage.evaluate((url) => window.open(url, "_blank"), ignoredUrl);
  const childPage = await childPagePromise;
  await childPage.waitForLoadState();

  await expect.poll(async () => (await extensionApi.tabByUrl(ignoredUrl))?.groupId ?? noGroupId, {
    message: "an ignored tab created inside a managed group should be removed despite its initial-URL exemption",
  }).toBe(noGroupId);
});
