import { describe, expect, it, vi } from "vitest";
import { createBundleMutationService } from "../../src/background/bundle-mutations.js";

function harness(groups = []) {
    let stored = { customDomainGroups: structuredClone(groups), futureSetting: { keep: true } };
    const chromeApi = { storage: { sync: {
        get: vi.fn(async () => structuredClone(stored)),
        set: vi.fn(async (payload) => { stored = { ...stored, ...structuredClone(payload) }; }),
    } } };
    const navigatorRef = { locks: { request: vi.fn(async (_name, callback) => callback()) } };
    const settingsState = { reload: vi.fn(async () => {}) };
    const enqueueForceReevaluation = vi.fn(async () => {});
    const service = createBundleMutationService({ chromeApi, navigatorRef, settingsState, enqueueForceReevaluation });
    return { chromeApi, navigatorRef, settingsState, enqueueForceReevaluation, service, getStored: () => stored };
}

const snapshot = (groups) => JSON.stringify(groups);

describe("bundle mutation service", () => {
    it("adds a canonical rule under the shared writer lock, reloads settings, and reevaluates", async () => {
        const groups = [{ title: "Work", domains: [], color: "blue", future: 7 }];
        const h = harness(groups);
        const result = await h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: " EXAMPLE.com/Docs/ " });

        expect(result).toEqual({ ok: true, status: "added", entry: "example.com/docs" });
        expect(h.navigatorRef.locks.request).toHaveBeenCalledWith("sumtabs:ignored-hostnames-storage", expect.any(Function));
        expect(h.getStored()).toEqual({ customDomainGroups: [{ title: "Work", domains: ["example.com/docs"], color: "blue", future: 7 }], futureSetting: { keep: true } });
        expect(h.settingsState.reload).toHaveBeenCalledBefore(h.enqueueForceReevaluation);
    });

    it("rejects stale snapshots and duplicate ownership without writing", async () => {
        const groups = [{ title: "One", domains: ["example.com"] }, { title: "Two", domains: [] }];
        const h = harness(groups);
        await expect(h.service.update({ operation: "add", bundleIndex: 1, expectedBundlesSnapshot: "[]", entry: "new.example" }))
            .resolves.toEqual({ ok: false, status: "stale-bundles" });
        await expect(h.service.update({ operation: "add", bundleIndex: 1, expectedBundlesSnapshot: snapshot(groups), entry: "EXAMPLE.com/" }))
            .resolves.toMatchObject({ ok: false, status: "duplicate-rule", entry: "example.com", owners: [{ groupIndex: 0 }] });
        expect(h.chromeApi.storage.sync.set).not.toHaveBeenCalled();
    });

    it("canonicalizes Unicode stored owners while retaining their original indexes", async () => {
        const removeGroups = [{ title: "A", domains: ["other.example", "bücher.de"] }];
        const remove = harness(removeGroups);
        await expect(remove.service.update({ operation: "remove", bundleIndex: 0, expectedBundlesSnapshot: snapshot(removeGroups), entry: "bücher.de" }))
            .resolves.toEqual({ ok: true, status: "removed", entry: "xn--bcher-kva.de" });
        expect(remove.getStored().customDomainGroups[0].domains).toEqual(["other.example"]);

        const addGroups = [{ title: "A", domains: ["bücher.de"] }, { title: "B", domains: [] }];
        const add = harness(addGroups);
        await expect(add.service.update({ operation: "add", bundleIndex: 1, expectedBundlesSnapshot: snapshot(addGroups), entry: "xn--bcher-kva.de" }))
            .resolves.toMatchObject({ ok: false, status: "duplicate-rule", entry: "xn--bcher-kva.de", owners: [{ groupIndex: 0, domainIndex: 0, entry: "xn--bcher-kva.de" }] });
        expect(add.chromeApi.storage.sync.set).not.toHaveBeenCalled();
    });

    it.each([
        { groups: [{ domains: [] }] },
        { groups: [{ title: "", domains: [] }] },
        { groups: [{ title: "   ", domains: [] }] },
        { groups: [{ title: 42, domains: [] }] },
    ])("rejects stored bundles with absent, blank, or non-string titles", async ({ groups }) => {
        const h = harness(groups);
        await expect(h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });
        expect(h.chromeApi.storage.sync.set).not.toHaveBeenCalled();
        expect(h.enqueueForceReevaluation).not.toHaveBeenCalled();
    });

    it("keeps an accepted operation queued behind the shared lock until its worker-owned promise completes", async () => {
        const groups = [{ title: "A", domains: [] }];
        const h = harness(groups);
        let enterLock;
        h.navigatorRef.locks.request.mockImplementationOnce((_name, callback) => new Promise((resolve, reject) => {
            enterLock = () => Promise.resolve(callback()).then(resolve, reject);
        }));

        const accepted = h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "example.com" });
        await Promise.resolve();
        expect(h.chromeApi.storage.sync.set).not.toHaveBeenCalled();
        enterLock();
        await expect(accepted).resolves.toEqual({ ok: true, status: "added", entry: "example.com" });
        expect(h.chromeApi.storage.sync.set).toHaveBeenCalledOnce();
        expect(h.settingsState.reload).toHaveBeenCalledBefore(h.enqueueForceReevaluation);
    });

    it("returns honest no-op statuses and validates operation, index, entry, and stored group shape", async () => {
        const groups = [{ title: "One", domains: ["example.com"] }];
        const h = harness(groups);
        await expect(h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "example.com" }))
            .resolves.toEqual({ ok: true, status: "already-present", entry: "example.com" });
        await expect(h.service.update({ operation: "remove", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "missing.example" }))
            .resolves.toEqual({ ok: true, status: "not-present", entry: "missing.example" });
        await expect(h.service.update({ operation: "replace", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });
        await expect(h.service.update({ operation: "add", bundleIndex: 8, expectedBundlesSnapshot: snapshot(groups), entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });
        await expect(h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "https://example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });

        const invalid = harness([{ title: "Broken", domains: "example.com" }]);
        await expect(invalid.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: snapshot([{ title: "Broken", domains: "example.com" }]), entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });
    });

    it("removes only the selected canonical entry and reports persistence followed by reevaluation failure", async () => {
        const groups = [{ title: "One", domains: ["EXAMPLE.com/Docs/*", "other.example"], extra: true }];
        const h = harness(groups);
        h.enqueueForceReevaluation.mockRejectedValueOnce(new Error("tabs unavailable"));
        const result = await h.service.update({ operation: "remove", bundleIndex: 0, expectedBundlesSnapshot: snapshot(groups), entry: "example.com/docs" });
        expect(result).toMatchObject({ ok: false, status: "saved-reevaluation-failed", entry: "example.com/docs" });
        expect(h.getStored().customDomainGroups).toEqual([{ title: "One", domains: ["other.example"], extra: true }]);
    });

    it("normalizes a missing bundle array to an empty snapshot and reports storage failures", async () => {
        const h = harness();
        h.chromeApi.storage.sync.get.mockResolvedValueOnce({});
        await expect(h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: "[]", entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "invalid-rule" });
        h.chromeApi.storage.sync.get.mockRejectedValueOnce(new Error("sync down"));
        await expect(h.service.update({ operation: "add", bundleIndex: 0, expectedBundlesSnapshot: "[]", entry: "example.com" }))
            .resolves.toMatchObject({ ok: false, status: "storage-error" });
    });
});
