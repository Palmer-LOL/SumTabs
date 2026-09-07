import { DEFAULTS } from "../core/defaults.js";
import { createChromeGroups } from "./chrome-groups.js";
import { createBundleMutationService } from "./bundle-mutations.js";
import { createSettingsState } from "./settings-state.js";
import { createTabController } from "./tab-controller.js";

const settingsState = createSettingsState({
    chromeApi: chrome,
    navigatorRef: navigator,
    defaults: DEFAULTS,
});
const chromeGroups = createChromeGroups({
    chromeApi: chrome,
    getManagedPrefix: () => settingsState.getRuntime().autoGroupPrefix,
});
const controller = createTabController({
    chromeApi: chrome,
    settingsState,
    chromeGroups,
});
const bundleMutations = createBundleMutationService({
    chromeApi: chrome,
    navigatorRef: navigator,
    settingsState,
    enqueueForceReevaluation: controller.enqueueForceReevaluation,
});

chrome.runtime.onStartup?.addListener(async () => {
    await settingsState.reload();
});

chrome.runtime.onInstalled?.addListener(async () => {
    await settingsState.reload();
});

chrome.storage.onChanged.addListener((changes, area) => {
    settingsState.handleStorageChange(
        changes,
        area,
        controller.enqueueForceReevaluation,
    );
});

settingsState.startInitialLoad();

chrome.tabs.onCreated.addListener(controller.handleTabCreated);
chrome.tabs.onUpdated.addListener(controller.handleTabUpdated);
chrome.tabs.onActivated.addListener(controller.handleTabActivated);
chrome.tabs.onRemoved.addListener(controller.handleTabRemoved);
chrome.windows.onFocusChanged.addListener(controller.handleWindowFocusChanged);
chrome.tabGroups.onRemoved?.addListener(controller.handleTabGroupRemoved);
chrome.tabGroups.onUpdated?.addListener(controller.handleTabGroupUpdated);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const response = message?.type === "sumtabs:update-bundle-rule"
        ? bundleMutations.update(message)
        : controller.handleRuntimeMessage(message);
    if (!response) return undefined;
    response.then(sendResponse);
    return true;
});
