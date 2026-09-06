import { test as base, chromium, expect } from "@playwright/test";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../..");
export const managedPrefix = "∑ ";
export const noGroupId = -1;
export const backgroundPath = "src/background/index.js";
export const settingsPath = "src/settings/settings.html";
export const popupPath = "src/popup/popup.html";

function chromeCallback(expression) {
  return `(async () => {
    const callbackify = (fn, ...args) => new Promise((resolve, reject) => {
      fn(...args, (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    });
    ${expression}
  })()`;
}

async function evaluateChrome(serviceWorker, expression) {
  return serviceWorker.evaluate(chromeCallback(expression));
}

async function getServiceWorker(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return serviceWorker;
}

async function openExtensionPage(context, extensionId, pagePath) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
  return page;
}

async function startServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const title = requestUrl.pathname.replace(/^\//, "") || "index";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${requestUrl.pathname}</p></body></html>`);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    url: (pathname) => `${baseUrl}${pathname}`,
    close: () => new Promise((resolve, reject) => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export const test = base.extend({
  context: async ({ headless }, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "sumtabs-pw-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless,
      args: [
        `--disable-extensions-except=${repoRoot}`,
        `--load-extension=${repoRoot}`,
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
      ],
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  serviceWorker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    expect(extensionId, "extension ID should be derived from the MV3 service worker URL").not.toBe("");
    await use(extensionId);
  },

  extensionPage: async ({ context, extensionId }, use) => {
    await use((pagePath) => openExtensionPage(context, extensionId, pagePath));
  },

  httpServer: async ({}, use) => {
    const server = await startServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  },

  extensionApi: async ({ context, extensionId, serviceWorker }, use) => {
    const evaluateInWorker = (expression) => evaluateChrome(serviceWorker, expression);
    const sendExtensionMessage = async (message) => {
      const page = await openExtensionPage(context, extensionId, settingsPath);
      try {
        return await page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
      } finally {
        await page.close();
      }
    };

    const api = {
      evaluate: evaluateInWorker,
      resetStorage: () => evaluateInWorker("await callbackify(chrome.storage.sync.clear.bind(chrome.storage.sync)); return true;"),
      getStorage: () => evaluateInWorker("return await callbackify(chrome.storage.sync.get.bind(chrome.storage.sync), null);"),
      setStorage: (values) => evaluateInWorker(`await callbackify(chrome.storage.sync.set.bind(chrome.storage.sync), ${JSON.stringify(values)}); return true;`),
      forceReevaluate: () => sendExtensionMessage({ type: "sumtabs:force-reevaluate" }),
      updateIgnoredHostname: (hostname, shouldIgnore) => sendExtensionMessage({
        type: "sumtabs:update-ignored-hostname",
        hostname,
        shouldIgnore,
      }),
      forceReevaluateTrackingCreatedTabs: async () => {
        const page = await openExtensionPage(context, extensionId, settingsPath);
        try {
          await evaluateInWorker("globalThis.__sumtabsCreatedTabs = []; globalThis.__sumtabsCreatedTabsListener = (tab) => globalThis.__sumtabsCreatedTabs.push({ id: tab.id, url: tab.pendingUrl || tab.url || '' }); chrome.tabs.onCreated.addListener(globalThis.__sumtabsCreatedTabsListener); return true;");
          await page.evaluate((payload) => chrome.runtime.sendMessage(payload), { type: "sumtabs:force-reevaluate" });
          return await evaluateInWorker("return globalThis.__sumtabsCreatedTabs || [];");
        } finally {
          await evaluateInWorker("if (globalThis.__sumtabsCreatedTabsListener) chrome.tabs.onCreated.removeListener(globalThis.__sumtabsCreatedTabsListener); delete globalThis.__sumtabsCreatedTabsListener; delete globalThis.__sumtabsCreatedTabs; return true;");
          await page.close();
        }
      },
      forceReevaluateWithActiveTab: async (url) => {
        const page = await openExtensionPage(context, extensionId, settingsPath);
        try {
          await evaluateInWorker(`const targetUrl = ${JSON.stringify(url)}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); const tab = tabs.find((candidate) => candidate.url === targetUrl); if (!tab) throw new Error('Tab not found for activation'); await callbackify(chrome.tabs.update.bind(chrome.tabs), tab.id, { active: true }); return true;`);
          return await page.evaluate((payload) => chrome.runtime.sendMessage(payload), { type: "sumtabs:force-reevaluate" });
        } finally {
          await page.close();
        }
      },
      tabByUrl: (url) => evaluateInWorker(`const targetUrl = ${JSON.stringify(url)}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); return tabs.find((tab) => tab.url === targetUrl) || null;`),
      tabsByUrls: (urls) => evaluateInWorker(`const urls = ${JSON.stringify(urls)}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); return urls.map((url) => tabs.find((tab) => tab.url === url) || null);`),
      groupById: (groupId) => evaluateInWorker(`return await callbackify(chrome.tabGroups.get.bind(chrome.tabGroups), ${JSON.stringify(groupId)});`),
      setGroupCollapsed: (groupId, collapsed) => evaluateInWorker(`return await callbackify(chrome.tabGroups.update.bind(chrome.tabGroups), ${JSON.stringify(groupId)}, { collapsed: ${JSON.stringify(collapsed)} });`),
      pinTabByUrl: (url) => evaluateInWorker(`const targetUrl = ${JSON.stringify(url)}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); const tab = tabs.find((candidate) => candidate.url === targetUrl); if (!tab) throw new Error('Tab not found for pinning'); return await callbackify(chrome.tabs.update.bind(chrome.tabs), tab.id, { pinned: true });`),
      createUserGroup: (urls, title) => evaluateInWorker(`const urls = ${JSON.stringify(urls)}; const tabs = await callbackify(chrome.tabs.query.bind(chrome.tabs), {}); const tabIds = []; for (const url of urls) { const tab = tabs.find((candidate) => candidate.url === url); if (!tab) throw new Error('Tab not found for user group: ' + url); tabIds.push(tab.id); } const groupId = await callbackify(chrome.tabs.group.bind(chrome.tabs), { tabIds }); await callbackify(chrome.tabGroups.update.bind(chrome.tabGroups), groupId, { title: ${JSON.stringify(title)} }); return { groupId, tabs: await callbackify(chrome.tabs.query.bind(chrome.tabs), { groupId }) };`),
    };
    await use(api);
  },
});

export { expect };

export async function openHttpPage(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

export async function expectTabsGrouped(extensionApi, urls, expectedTitlePrefix = managedPrefix) {
  return expect.poll(async () => {
    const tabs = await extensionApi.tabsByUrls(urls);
    const groupIds = tabs.map((tab) => tab?.groupId ?? noGroupId);
    if (groupIds.some((groupId) => groupId === noGroupId)) return null;
    if (!groupIds.every((groupId) => groupId === groupIds[0])) return null;
    const group = await extensionApi.groupById(groupIds[0]);
    return { groupId: groupIds[0], title: group.title, tabIds: tabs.map((tab) => tab.id) };
  }, { message: `expected ${urls.join(", ")} to share a managed tab group` }).toMatchObject({ title: expect.stringMatching(new RegExp(`^${expectedTitlePrefix}`)) });
}
