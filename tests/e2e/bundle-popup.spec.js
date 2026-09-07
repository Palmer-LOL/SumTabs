import {
  expect,
  managedPrefix,
  noGroupId,
  openHttpPage,
  popupPath,
  settingsPath,
  test,
} from "./fixtures.js";

const bundleLockName = "sumtabs:ignored-hostnames-storage";

test.beforeEach(async ({ extensionApi }) => {
  await extensionApi.resetStorage();
});

async function openPopupFor({ context, extensionId, extensionApi }, targetUrl) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/${popupPath}`);
  await extensionApi.activateTabByUrl(targetUrl);
  await popup.reload();
  return popup;
}

async function openBundleActions(popup) {
  const card = popup.locator("#bundleActionsCard");
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
  return card;
}

async function setBundles(extensionApi, customDomainGroups) {
  await extensionApi.setStorage({ customDomainGroups });
}

test("browses every configured bundle, including an empty non-first bundle", async ({ context, extensionId, extensionApi, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/guide/start");
  await setBundles(extensionApi, [
    { title: "First", color: "blue", domains: ["first.example"] },
    { title: "Empty target", color: "purple", domains: [] },
    { title: "Last", color: "red", domains: ["last.example"] },
  ]);
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);

  const bundleSelect = popup.locator("#bundleSelect");
  await expect(bundleSelect.locator("option")).toHaveText(["First", "Empty target", "Last"]);
  await bundleSelect.selectOption("1");
  await expect(popup.locator("#bundleRuleSelect option")).toHaveCount(0);
  await expect(popup.locator("#removeBundleAction")).toBeDisabled();
  await expect(popup.locator("#bundleColor")).toHaveText("Color: purple");

  await popup.locator("#bundleHostScope").selectOption("example.test");
  await popup.locator("#bundlePathScope").selectOption("/guide");
  await expect(bundleSelect).toHaveValue("1");
  await expect(popup.locator("#bundleRulePreview")).toHaveText("Rule: example.test/guide");
});

test("shows the bundle disclosure empty state when no bundles are configured", async ({ context, extensionId, extensionApi, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/guide");
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);

  await expect(popup.locator("#bundleSelect")).toBeDisabled();
  await expect(popup.locator("#bundleColor")).toHaveText("No custom bundles yet.");
  await expect(popup.locator("#applyBundleAction")).toBeDisabled();
  await expect(popup.locator("#removeBundleAction")).toBeDisabled();
});

test("stores a canonical root and segment path rule in the selected non-first bundle", async ({ context, extensionId, extensionApi, httpServer }) => {
  const targetUrl = `${httpServer.urlFor("docs.example.test", "/projects/alpha")}?view=wide#notes`;
  await setBundles(extensionApi, [
    { title: "Personal", color: "blue", domains: ["personal.example"] },
    { title: "Project", color: "orange", domains: [] },
  ]);
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);

  await popup.locator("#bundleSelect").selectOption("1");
  await popup.locator("#bundleHostScope").selectOption("example.test");
  await popup.locator("#bundlePathScope").selectOption("/projects");
  await expect(popup.locator("#bundleRulePreview")).toHaveText("Rule: example.test/projects");
  await popup.locator("#applyBundleAction").click();

  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([
    { title: "Personal", color: "blue", domains: ["personal.example"] },
    { title: "Project", color: "orange", domains: ["example.test/projects"] },
  ]);
  await expect(popup.locator("#popupFeedback")).toHaveText("Rule added to Project. Open tabs have been reorganized.");
  await expect(popup.locator("#bundleSelect")).toHaveValue("1");
});

test("applies a root path rule to sibling hosts and descendants but not a partial segment", async ({ context, extensionId, extensionApi, httpServer }) => {
  const seedUrl = httpServer.urlFor("docs.example.test", "/projects/alpha?x=1#top");
  const siblingUrl = httpServer.urlFor("app.example.test", "/projects/beta");
  const boundaryUrl = httpServer.urlFor("app.example.test", "/projectship/nope");
  await setBundles(extensionApi, [{ title: "Project", color: "orange", domains: [] }]);
  for (const url of [seedUrl, siblingUrl, boundaryUrl]) await openHttpPage(context, url);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, seedUrl);
  await openBundleActions(popup);
  await popup.locator("#bundleHostScope").selectOption("example.test");
  await popup.locator("#bundlePathScope").selectOption("/projects");
  await popup.locator("#applyBundleAction").click();

  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups?.[0]?.domains).toEqual(["example.test/projects"]);
  await expect.poll(async () => {
    const tabs = await extensionApi.tabsByUrls([seedUrl, siblingUrl, boundaryUrl]);
    const [first, second, boundary] = tabs.map((tab) => tab?.groupId ?? noGroupId);
    return first !== noGroupId && first === second && boundary !== first;
  }).toBe(true);
  const [groupedTab] = await extensionApi.tabsByUrls([seedUrl]);
  const group = await extensionApi.groupById(groupedTab.groupId);
  expect(group).toMatchObject({ title: `${managedPrefix}Project`, color: "orange" });
});

test("disables adding the same exact rule to its current or another bundle", async ({ context, extensionId, extensionApi, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/projects/alpha");
  await setBundles(extensionApi, [
    { title: "Owner", domains: ["example.test/projects"] },
    { title: "Other", domains: [] },
  ]);
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);
  await popup.locator("#bundleHostScope").selectOption("example.test");
  await popup.locator("#bundlePathScope").selectOption("/projects");

  await expect(popup.locator("#applyBundleAction")).toBeDisabled();
  await expect(popup.locator("#bundleActionStatus")).toContainText("already stored in this bundle");
  await popup.locator("#bundleSelect").selectOption("1");
  await expect(popup.locator("#applyBundleAction")).toBeDisabled();
  await expect(popup.locator("#bundleActionStatus")).toContainText("already owned by Owner");
});

test("removes the explicitly selected stored rule from the selected bundle", async ({ context, extensionId, extensionApi, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/projects/alpha");
  await setBundles(extensionApi, [{
    title: "Project",
    domains: ["keep.example", "example.test/projects", "also-keep.example"],
  }]);
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);
  await expect(popup.locator("#removeBundleAction")).toBeDisabled();
  await popup.locator("#bundleRuleSelect").selectOption("example.test/projects");
  await expect(popup.locator("#removeBundleAction")).toBeEnabled();
  await popup.locator("#removeBundleAction").click();

  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([{
    title: "Project",
    domains: ["keep.example", "also-keep.example"],
  }]);
});

test("rejects an add when bundles are renamed or reordered while the request waits on the storage lock", async ({ context, extensionId, extensionApi, extensionPage, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/guide");
  const original = [{ title: "One", domains: [] }, { title: "Two", domains: [] }];
  const reordered = [{ title: "Two renamed", domains: [] }, { title: "One", domains: [] }];
  await setBundles(extensionApi, original);
  await openHttpPage(context, targetUrl);
  const lockPage = await extensionPage(settingsPath);
  await lockPage.evaluate((lockName) => {
    globalThis.lockHeld = false;
    globalThis.lockTask = navigator.locks.request(lockName, async () => {
      globalThis.lockHeld = true;
      await new Promise((resolve) => { globalThis.releaseLock = resolve; });
    });
  }, bundleLockName);
  await expect.poll(() => lockPage.evaluate(() => globalThis.lockHeld)).toBe(true);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);
  await popup.locator("#bundleSelect").selectOption("1");
  try {
    await popup.locator("#applyBundleAction").click();
    await expect.poll(async () => lockPage.evaluate((lockName) => navigator.locks.query().then(
      (snapshot) => snapshot.pending.filter((lock) => lock.name === lockName).length,
    ), bundleLockName)).toBe(1);
    await extensionApi.setStorage({ customDomainGroups: reordered });
  } finally {
    await lockPage.evaluate(() => globalThis.releaseLock?.());
  }

  await expect(popup.locator("#popupFeedback")).toContainText("Bundles changed in Settings");
  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual(reordered);
  await expect(popup.locator("#bundleSelect option").first()).toHaveText("Choose a bundle");
  await expect(popup.locator("#bundleSelect")).toHaveValue("");
  await expect(popup.locator("#applyBundleAction")).toBeDisabled();
  await expect(popup.locator("#removeBundleAction")).toBeDisabled();

  await popup.locator("#bundleSelect").selectOption("0");
  await expect(popup.locator("#applyBundleAction")).toBeEnabled();
  await popup.locator("#applyBundleAction").click();
  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([
    { title: "Two renamed", domains: ["docs.example.test"] },
    { title: "One", domains: [] },
  ]);
});

test("finishes a queued popup mutation after its popup tab closes", async ({ context, extensionId, extensionApi, extensionPage, httpServer }) => {
  const targetUrl = httpServer.urlFor("docs.example.test", "/queued");
  await setBundles(extensionApi, [{ title: "Queued", domains: [] }]);
  await openHttpPage(context, targetUrl);
  const lockPage = await extensionPage(settingsPath);
  await lockPage.evaluate((lockName) => {
    globalThis.lockHeld = false;
    globalThis.lockTask = navigator.locks.request(lockName, async () => {
      globalThis.lockHeld = true;
      await new Promise((resolve) => { globalThis.releaseLock = resolve; });
    });
  }, bundleLockName);
  await expect.poll(() => lockPage.evaluate(() => globalThis.lockHeld)).toBe(true);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);
  await popup.locator("#applyBundleAction").click();
  await expect.poll(async () => (await lockPage.evaluate((lockName) => navigator.locks.query().then((s) => s.pending.filter((l) => l.name === lockName).length), bundleLockName))).toBe(1);
  await popup.close();
  await lockPage.evaluate(() => globalThis.releaseLock());

  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([
    { title: "Queued", domains: ["docs.example.test"] },
  ]);
});

test("keeps pinned, ignored, and user-group tabs protected after adding a matching rule", async ({ context, extensionId, extensionApi, httpServer }) => {
  const pinnedUrl = httpServer.urlFor("pinned.example.test", "/scope/a");
  const ignoredUrl = httpServer.urlFor("ignored.example.test", "/scope/b");
  const userUrls = [
    httpServer.urlFor("manual.example.test", "/scope/c"),
    httpServer.urlFor("manual.example.test", "/scope/d"),
  ];
  const seedUrl = httpServer.urlFor("seed.example.test", "/scope/e");
  const ordinaryUrl = httpServer.urlFor("ordinary.example.test", "/scope/f");
  await setBundles(extensionApi, [{ title: "Protected", domains: [] }]);
  for (const url of [pinnedUrl, ignoredUrl, ...userUrls, seedUrl, ordinaryUrl]) await openHttpPage(context, url);
  await extensionApi.pinTabByUrl(pinnedUrl);
  await extensionApi.updateIgnoredHostname("ignored.example.test", true);
  const userGroup = await extensionApi.createUserGroup(userUrls, "Manual group");
  const popup = await openPopupFor({ context, extensionId, extensionApi }, seedUrl);
  await openBundleActions(popup);
  await popup.locator("#bundleHostScope").selectOption("example.test");
  await popup.locator("#applyBundleAction").click();

  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups?.[0]?.domains).toEqual(["example.test"]);
  await expect.poll(async () => {
    const [seed, ordinary] = await extensionApi.tabsByUrls([seedUrl, ordinaryUrl]);
    return seed?.groupId !== noGroupId && seed?.groupId === ordinary?.groupId;
  }).toBe(true);

  await expect.poll(async () => {
    const [pinned, ignored, ...manual] = await extensionApi.tabsByUrls([pinnedUrl, ignoredUrl, ...userUrls]);
    return {
      pinned: { pinned: pinned?.pinned, groupId: pinned?.groupId },
      ignoredGroupId: ignored?.groupId,
      manualGroupIds: manual.map((tab) => tab?.groupId),
    };
  }).toEqual({
    pinned: { pinned: true, groupId: noGroupId },
    ignoredGroupId: noGroupId,
    manualGroupIds: [userGroup.groupId, userGroup.groupId],
  });
  expect((await extensionApi.groupById(userGroup.groupId)).title).toBe("Manual group");
  const [ordinary] = await extensionApi.tabsByUrls([ordinaryUrl]);
  expect(await extensionApi.groupById(ordinary.groupId)).toMatchObject({ title: `${managedPrefix}Protected` });
});

test("supports browsing and removal on a non-HTTP active tab while add controls stay unavailable", async ({ context, extensionId, extensionApi, extensionPage }) => {
  await setBundles(extensionApi, [{ title: "Stored", domains: ["example.test/path"] }]);
  const settings = await extensionPage(settingsPath);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, settings.url());
  await openBundleActions(popup);
  await expect(popup.locator("#bundleRulePreview")).toContainText("Open an HTTP or HTTPS page");
  await expect(popup.locator("#applyBundleAction")).toBeDisabled();
  await popup.locator("#bundleRuleSelect").selectOption("example.test/path");
  await popup.locator("#removeBundleAction").click();
  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([{ title: "Stored", domains: [] }]);
});

test("absorbs an external bundle update when the Settings bundle editor is clean", async ({ extensionPage, extensionApi }) => {
  await setBundles(extensionApi, [{ title: "Before", domains: [] }]);
  const settings = await extensionPage(settingsPath);
  await settings.getByText("Custom bundles", { exact: true }).click();
  await extensionApi.setStorage({ customDomainGroups: [{ title: "From popup", domains: ["example.test"] }] });
  await expect(settings.getByLabel("Bundle title")).toHaveValue("From popup");
  await expect(settings.locator("#bundleConflict")).toBeHidden();
});

test("requires a choice for a popup add while the structured bundle editor is dirty and preserves unrelated drafts", async ({ context, extensionId, extensionPage, extensionApi, httpServer }) => {
  await setBundles(extensionApi, [{ title: "Before", domains: [] }]);
  const settings = await extensionPage(settingsPath);
  await settings.getByText("Custom bundles", { exact: true }).click();
  await settings.getByLabel("Bundle title").fill("My bundle draft");
  await settings.getByText("Site separation rules", { exact: true }).click();
  await settings.getByLabel("Ignore these specific hostnames").fill("unrelated-draft.example");
  const targetUrl = httpServer.urlFor("docs.example.test", "/settings-conflict");
  await openHttpPage(context, targetUrl);
  const popup = await openPopupFor({ context, extensionId, extensionApi }, targetUrl);
  await openBundleActions(popup);
  await popup.locator("#applyBundleAction").click();
  await expect.poll(async () => (await extensionApi.getStorage()).customDomainGroups).toEqual([
    { title: "Before", domains: ["docs.example.test"] },
  ]);

  await expect(settings.locator("#bundleConflict")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(settings.getByLabel("Bundle title")).toHaveValue("My bundle draft");
  await settings.locator("#keepDraftBundles").click();
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await expect(settings.getByLabel("Ignore these specific hostnames")).toHaveValue("unrelated-draft.example");
});

test("treats unapplied raw bundle JSON as dirty during an external update", async ({ extensionPage, extensionApi }) => {
  await setBundles(extensionApi, [{ title: "Before", domains: [] }]);
  const settings = await extensionPage(settingsPath);
  await settings.getByText("Custom bundles", { exact: true }).click();
  await settings.getByText("Advanced: view or edit raw JSON", { exact: true }).click();
  const raw = settings.locator("#customDomainGroupsJson");
  const rawDraft = '[{"title":"Raw draft","domains":["draft.example"]}]';
  await raw.fill(rawDraft);
  await extensionApi.setStorage({ customDomainGroups: [{ title: "From popup", domains: ["example.test"] }] });

  await expect(settings.locator("#bundleConflict")).toBeVisible();
  await expect(raw).toHaveValue(rawDraft);
  await settings.locator("#useStoredBundles").click();
  await expect(settings.locator("#bundleConflict")).toBeHidden();
  await expect(raw).toHaveValue(/From popup/);
});
