import { buildCustomBundleMaps } from "../core/grouping.js";

const VALID_GROUP_COLORS = [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
];
const IGNORED_HOSTNAMES_STORAGE_LOCK = "sumtabs:ignored-hostnames-storage";

function cloneBundleRuleMap(source) {
    return new Map([...source.entries()].map(([hostname, entries]) => [
        hostname,
        entries.map((entry) => ({
            ...entry,
            rule: { ...entry.rule },
        })),
    ]));
}

function cloneBundleMaps(source) {
    return {
        exactHostnameToBundleRules: cloneBundleRuleMap(source.exactHostnameToBundleRules),
        rootDomainToBundleRules: cloneBundleRuleMap(source.rootDomainToBundleRules),
    };
}

export function createSettingsState({ chromeApi, navigatorRef, defaults }) {
    let settings = structuredClone(defaults);

    let commonMultipartSuffixes = new Set(defaults.commonMultipartSuffixes);
    let excludedFromRootCollapse = new Set(defaults.excludedFromRootCollapse);
    let ignoredHostnames = new Set(defaults.ignoredHostnames);
    let autoGroupPrefix = defaults.autoGroupPrefix;
    let minTabsToGroup = defaults.minTabsToGroup;
    let collapseOtherGroupsOnNavEvents = defaults.collapseOtherGroupsOnNavEvents;
    let keepManagedGroupsAtFront = defaults.keepManagedGroupsAtFront;
    let ungroupSingletonManagedGroups = defaults.ungroupSingletonManagedGroups;
    let ignoreInitialTabUrl = defaults.ignoreInitialTabUrlForGrouping
        && defaults.ignoreInitialTabUrlForEnforcement;

    let customBundleMaps = {
        exactHostnameToBundleRules: new Map(),
        rootDomainToBundleRules: new Map(),
    };
    let customIdentityToColor = new Map();
    let settingsReady = Promise.resolve();
    let ignoredHostnameUpdateQueue = Promise.resolve();
    const ignoredHostnameChangeWaiters = [];

    function rebuildDerived() {
        autoGroupPrefix = settings.autoGroupPrefix ?? defaults.autoGroupPrefix;
        const rawMinTabsToGroup = Number(settings.minTabsToGroup);
        minTabsToGroup = Number.isFinite(rawMinTabsToGroup)
            ? Math.max(2, Math.floor(rawMinTabsToGroup))
            : defaults.minTabsToGroup;
        collapseOtherGroupsOnNavEvents = !!settings.collapseOtherGroupsOnNavEvents;
        keepManagedGroupsAtFront = !!settings.keepManagedGroupsAtFront;
        ungroupSingletonManagedGroups = !!settings.ungroupSingletonManagedGroups;
        // These legacy storage keys now represent one setting. Treat a historical
        // mismatch as disabled so grouping and enforcement can never diverge.
        ignoreInitialTabUrl = !!settings.ignoreInitialTabUrlForGrouping
            && !!settings.ignoreInitialTabUrlForEnforcement;

        commonMultipartSuffixes = new Set(
            (settings.commonMultipartSuffixes ?? []).map(s => String(s).toLowerCase()),
        );
        excludedFromRootCollapse = new Set(
            (settings.excludedFromRootCollapse ?? []).map(s => String(s).toLowerCase()),
        );
        ignoredHostnames = new Set(
            (settings.ignoredHostnames ?? [])
                .map(s => String(s).trim().toLowerCase())
                .filter(Boolean),
        );

        customBundleMaps = buildCustomBundleMaps(settings.customDomainGroups);
        customIdentityToColor = new Map();
        for (const group of (settings.customDomainGroups ?? [])) {
            if (!group?.title || !Array.isArray(group.domains)) continue;

            const title = String(group.title).trim();
            if (!title) continue;

            const identity = autoGroupPrefix + title;
            const color = String(group?.color ?? "").trim().toLowerCase();
            if (VALID_GROUP_COLORS.includes(color)) customIdentityToColor.set(identity, color);
        }
    }

    async function loadSettings() {
        settings = await chromeApi.storage.sync.get(defaults);
        rebuildDerived();
    }

    function startInitialLoad() {
        settingsReady = loadSettings();
        return settingsReady;
    }

    async function awaitReady() {
        await settingsReady;
    }

    async function reload() {
        await loadSettings();
    }

    function getRuntime() {
        return {
            commonMultipartSuffixes: new Set(commonMultipartSuffixes),
            excludedFromRootCollapse: new Set(excludedFromRootCollapse),
            ignoredHostnames: new Set(ignoredHostnames),
            autoGroupPrefix,
            minTabsToGroup,
            collapseOtherGroupsOnNavEvents,
            keepManagedGroupsAtFront,
            ungroupSingletonManagedGroups,
            ignoreInitialTabUrl,
            customBundleMaps: cloneBundleMaps(customBundleMaps),
            customIdentityToColor: new Map(customIdentityToColor),
        };
    }

    function ignoredHostnamesSignature(values) {
        return JSON.stringify(
            [...new Set((values ?? [])
                .map(value => String(value).trim().toLowerCase())
                .filter(Boolean))]
                .sort(),
        );
    }

    function handleStorageChange(changes, area, enqueueForceReevaluation) {
        if (area !== "sync") return;
        for (const [key, value] of Object.entries(changes)) settings[key] = value.newValue;
        rebuildDerived();

        if (changes.keepManagedGroupsAtFront?.newValue || changes.ignoredHostnames) {
            const reevaluation = enqueueForceReevaluation();

            if (changes.ignoredHostnames) {
                const signature = ignoredHostnamesSignature(changes.ignoredHostnames.newValue);
                const matchingWaiters = ignoredHostnameChangeWaiters
                    .filter(waiter => waiter.signature === signature);
                for (const waiter of matchingWaiters) {
                    ignoredHostnameChangeWaiters.splice(ignoredHostnameChangeWaiters.indexOf(waiter), 1);
                    reevaluation.then(waiter.resolve, waiter.reject);
                }
            }

            // Storage changes without a popup awaiting completion still need error
            // isolation so the service worker does not produce an unhandled rejection.
            reevaluation.catch(() => {});
        }
    }

    async function updateIgnoredHostname(hostname, shouldIgnore, enqueueForceReevaluation) {
        const normalizedHostname = String(hostname ?? "").trim().toLowerCase();
        if (!normalizedHostname) throw new Error("A hostname is required.");

        const stored = await chromeApi.storage.sync.get(defaults);
        const nextIgnoredHostnameSet = new Set(
            (stored.ignoredHostnames ?? [])
                .map(value => String(value).trim().toLowerCase())
                .filter(Boolean),
        );
        if (shouldIgnore) nextIgnoredHostnameSet.add(normalizedHostname);
        else nextIgnoredHostnameSet.delete(normalizedHostname);

        const nextIgnoredHostnames = [...nextIgnoredHostnameSet];
        const currentSignature = ignoredHostnamesSignature(stored.ignoredHostnames);
        const nextSignature = ignoredHostnamesSignature(nextIgnoredHostnames);
        if (currentSignature === nextSignature) {
            await enqueueForceReevaluation();
            return;
        }

        let resolveChange;
        let rejectChange;
        const changeCompleted = new Promise((resolve, reject) => {
            resolveChange = resolve;
            rejectChange = reject;
        });
        const waiter = { signature: nextSignature, resolve: resolveChange, reject: rejectChange };
        ignoredHostnameChangeWaiters.push(waiter);

        try {
            await chromeApi.storage.sync.set({ ignoredHostnames: nextIgnoredHostnames });
            await changeCompleted;
        } catch (error) {
            const waiterIndex = ignoredHostnameChangeWaiters.indexOf(waiter);
            if (waiterIndex !== -1) ignoredHostnameChangeWaiters.splice(waiterIndex, 1);
            throw error;
        }
    }

    function enqueueIgnoredHostnameUpdate(hostname, shouldIgnore, enqueueForceReevaluation) {
        const update = ignoredHostnameUpdateQueue
            .catch(() => {})
            .then(() => updateIgnoredHostname(
                hostname,
                shouldIgnore,
                enqueueForceReevaluation,
            ));
        ignoredHostnameUpdateQueue = update;
        return update;
    }

    function updateIgnoredHostnameWithLock(hostname, shouldIgnore, enqueueForceReevaluation) {
        return navigatorRef.locks.request(IGNORED_HOSTNAMES_STORAGE_LOCK, () => (
            enqueueIgnoredHostnameUpdate(hostname, shouldIgnore, enqueueForceReevaluation)
        ));
    }

    return {
        startInitialLoad,
        awaitReady,
        reload,
        getRuntime,
        handleStorageChange,
        enqueueIgnoredHostnameUpdate,
        updateIgnoredHostnameWithLock,
    };
}
