import {
	buildCustomBundleMaps,
	getCustomDomainBundleEntryOwners,
	getDomainWideSeparationRule,
	resolveGroupingForHostname,
} from "../core/grouping.js";
import { isWebUrl, safeParseUrl } from "../core/urls.js";

function normalizeLowerList(values) {
	return new Set(
		Array.from(values ?? [])
			.map((value) =>
				String(value ?? "")
					.trim()
					.toLowerCase(),
			)
			.filter(Boolean),
	);
}

function getGroupingTargetLabel(grouping) {
	if (grouping.reason === "custom-bundle-grouping") return grouping.identity;
	return grouping.displayGroupingLabel;
}

function getExplanation(tab, grouping) {
	if (tab.pinned) {
		return "This tab is separate because pinned tabs are never grouped.";
	}

	switch (grouping.reason) {
		case "custom-bundle-grouping":
			return `This tab is grouped under the custom bundle ${grouping.identity}.`;
		case "exact-host-separation":
			return `This tab is separate because ${grouping.hostname} is set to stay separate.`;
		case "multipart-suffix-separation":
			return `This tab is separate because ${grouping.matchedSuffix} is set to treat subdomains independently.`;
		case "default-root-domain-grouping":
		default:
			return `This tab is grouped with ${grouping.displayGroupingLabel} by default.`;
	}
}

function tabTargetLabel(tab, grouping) {
	if (tab.pinned) return "Not grouped";
	return getGroupingTargetLabel(grouping);
}

export async function getActiveTabStatus({ chromeApi, defaults }) {
	const [activeTab] = await chromeApi.tabs.query({
		active: true,
		currentWindow: true,
	});

	if (!activeTab?.url) {
		return {
			status: {
				hostname: "Unavailable",
				target: "Unavailable",
				explanation: "This tab’s URL is not available right now.",
			},
			context: null,
		};
	}

	const parsedUrl = safeParseUrl(activeTab.url);
	if (!isWebUrl(parsedUrl)) {
		return {
			status: {
				hostname: "Unsupported page",
				target: "Not grouped",
				explanation:
					"This page is not grouped because only web pages can be grouped.",
			},
			context: null,
		};
	}

	const settings = await chromeApi.storage.sync.get(defaults);
	const commonMultipartSuffixes = normalizeLowerList(
		settings.commonMultipartSuffixes,
	);
	const excludedFromRootCollapse = normalizeLowerList(
		settings.excludedFromRootCollapse,
	);
	const ignoredHostnames = normalizeLowerList(settings.ignoredHostnames);
	const hostname = parsedUrl.hostname.toLowerCase();
	const isIgnored = ignoredHostnames.has(hostname);
	// Mirror the background worker's shared precedence so the popup explanation matches runtime grouping behavior.
	const grouping = resolveGroupingForHostname({
		url: parsedUrl.href,
		hostname: parsedUrl.hostname,
		pathname: parsedUrl.pathname,
		commonMultipartSuffixes,
		excludedFromRootCollapse,
		ignoredHostnames,
		customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
		managedPrefix: settings.autoGroupPrefix ?? defaults.autoGroupPrefix,
	});
	const groupingWithoutIgnore =
		grouping ??
		resolveGroupingForHostname({
			url: parsedUrl.href,
			hostname,
			pathname: parsedUrl.pathname,
			commonMultipartSuffixes,
			excludedFromRootCollapse,
			customBundleMaps: buildCustomBundleMaps(settings.customDomainGroups),
			managedPrefix: settings.autoGroupPrefix ?? defaults.autoGroupPrefix,
		});
	const domainAction = getDomainWideSeparationRule(
		hostname,
		commonMultipartSuffixes,
	);
	const domainActionAvailable = !!domainAction;
	const customDomainGroups = Array.isArray(settings.customDomainGroups)
		? settings.customDomainGroups
		: [];
	const bundleOwners = getCustomDomainBundleEntryOwners(
		customDomainGroups,
		hostname,
	);
	const bundleMembershipByIndex = new Set(
		bundleOwners.map((owner) => owner.groupIndex),
	);

	return {
		status: {
			hostname,
			target: isIgnored
				? "Ignored"
				: tabTargetLabel(activeTab, groupingWithoutIgnore),
			explanation: isIgnored
				? `This tab is unmanaged because ${hostname} is on the ignored-hostnames list.`
				: getExplanation(activeTab, groupingWithoutIgnore),
		},
		context: {
			hostname,
			ignoreActionEnabled: isIgnored,
			exactActionEnabled: excludedFromRootCollapse.has(hostname),
			domainActionAvailable,
			domainActionEnabled:
				domainActionAvailable &&
				commonMultipartSuffixes.has(domainAction.token),
			domainActionAffectsCurrentTab: domainAction?.affectsHostname ?? false,
			domainActionLabel: domainAction?.label ?? "",
			domainActionToken: domainAction?.token ?? "",
			customDomainGroups,
			bundleMembershipByIndex,
			bundleOwners,
		},
	};
}

export async function getBundleActionsContext({ chromeApi, defaults }) {
	const [[activeTab], settings] = await Promise.all([
		chromeApi.tabs.query({ active: true, currentWindow: true }),
		chromeApi.storage.sync.get(defaults),
	]);
	let userGroup = false;
	if (activeTab && Number(activeTab.groupId) >= 0 && chromeApi.tabGroups?.get) {
		try {
			const group = await chromeApi.tabGroups.get(activeTab.groupId);
			userGroup = !String(group?.title ?? "").startsWith(
				settings.autoGroupPrefix ?? defaults.autoGroupPrefix,
			);
		} catch {
			userGroup = true;
		}
	}
	return {
		url: activeTab?.url ?? "",
		activeTab: activeTab ? { ...activeTab, userGroup } : null,
		settings: {
			...settings,
			customDomainGroups: Array.isArray(settings.customDomainGroups)
				? settings.customDomainGroups
				: [],
		},
	};
}
