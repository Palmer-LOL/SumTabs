import { getCustomDomainBundleEntryOwners } from "../core/grouping.js";
import { canonicalizeDomainEntry } from "../settings/validation.js";

const SETTINGS_STORAGE_LOCK = "sumtabs:ignored-hostnames-storage";

function bundlesFromStored(stored) {
    return Array.isArray(stored?.customDomainGroups) ? stored.customDomainGroups : [];
}

function invalid(error) {
    return { ok: false, status: "invalid-rule", error };
}

export function createBundleMutationService({
    chromeApi,
    navigatorRef,
    settingsState,
    enqueueForceReevaluation,
}) {
    async function update(message) {
        if (!message || !["add", "remove"].includes(message.operation)) {
            return invalid("Operation must be add or remove.");
        }
        if (!Number.isInteger(message.bundleIndex) || message.bundleIndex < 0) {
            return invalid("Bundle index is invalid.");
        }
        if (typeof message.expectedBundlesSnapshot !== "string") {
            return invalid("Expected bundle snapshot is required.");
        }

        const canonical = canonicalizeDomainEntry(message.entry);
        if (!canonical.valid) return invalid(canonical.error || "Rule is invalid.");
        const entry = canonical.canonicalEntry;
        let persisted = false;

        try {
            const result = await navigatorRef.locks.request(SETTINGS_STORAGE_LOCK, async () => {
                const stored = await chromeApi.storage.sync.get(null);
                const groups = bundlesFromStored(stored);
                if (JSON.stringify(groups) !== message.expectedBundlesSnapshot) {
                    return { ok: false, status: "stale-bundles" };
                }

                if (groups.some(group => !group || typeof group !== "object"
                    || !Array.isArray(group.domains)
                    || group.domains.some(domain => typeof domain !== "string"
                        || !canonicalizeDomainEntry(domain).valid))) {
                    return invalid("Stored custom bundles are invalid.");
                }

                const selected = groups[message.bundleIndex];
                if (!selected) {
                    return invalid("The selected stored bundle is invalid.");
                }

                const owners = getCustomDomainBundleEntryOwners(groups, entry);
                const selectedOwner = owners.find(owner => owner.groupIndex === message.bundleIndex);
                if (message.operation === "add") {
                    if (selectedOwner) return { ok: true, status: "already-present", entry };
                    if (owners.length) return { ok: false, status: "duplicate-rule", entry, owners };
                } else if (!selectedOwner) {
                    return { ok: true, status: "not-present", entry };
                }

                const nextGroups = structuredClone(groups);
                if (message.operation === "add") {
                    nextGroups[message.bundleIndex].domains.push(entry);
                } else {
                    nextGroups[message.bundleIndex].domains.splice(selectedOwner.domainIndex, 1);
                }
                await chromeApi.storage.sync.set({ customDomainGroups: nextGroups });
                persisted = true;
                return {
                    ok: true,
                    status: message.operation === "add" ? "added" : "removed",
                    entry,
                };
            });

            if (!result.ok || !["added", "removed"].includes(result.status)) return result;

            try {
                await settingsState.reload();
                await enqueueForceReevaluation();
                return result;
            } catch (error) {
                return { ok: false, status: "saved-reevaluation-failed", entry, error: String(error) };
            }
        } catch (error) {
            return {
                ok: false,
                status: persisted ? "saved-reevaluation-failed" : "storage-error",
                ...(persisted ? { entry } : {}),
                error: String(error),
            };
        }
    }

    return { update };
}
