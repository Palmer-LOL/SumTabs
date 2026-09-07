import { describe, expect, it, vi } from "vitest";
import { createBundleActions } from "../../src/popup/bundle-actions.js";

class FakeElement {
	constructor(ownerDocument) {
		this.ownerDocument = ownerDocument; this.children = []; this.listeners = {};
		this.value = ""; this.textContent = ""; this.disabled = false; this.hidden = false;
		this.style = { setProperty: (name, value) => { this.style[name] = value; } };
	}
	appendChild(child) { this.children.push(child); return child; }
	replaceChildren(...children) { this.children = children; this.value = ""; }
	addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
	async emit(type) { for (const listener of this.listeners[type] ?? []) await listener(); }
	setAttribute(name, value) { this[name] = value; }
}

function setup({ refresh = vi.fn() } = {}) {
	const documentRef = { createElement: () => new FakeElement(documentRef) };
	const elements = Object.fromEntries(["card", "bundleSelect", "bundleColor", "hostScope", "pathScope", "preview", "ruleSelect", "status", "apply", "remove", "openSettings"].map((key) => [key, new FakeElement(documentRef)]));
	elements.ruleSelect.size = 4;
	const sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "added" });
	const announce = vi.fn();
	const actions = createBundleActions({ chromeApi: { runtime: { sendMessage, openOptionsPage: vi.fn() } }, elements, announce, refresh });
	actions.bind();
	return { actions, elements, sendMessage, announce };
}

const context = {
	url: "https://docs.example.com/projects/alpha?sort=new#top",
	activeTab: { pinned: false, groupId: -1 },
	settings: { commonMultipartSuffixes: [], customDomainGroups: [
		{ title: "Work", color: "blue", domains: ["old.example.com"] },
		{ title: "Empty", color: "red", domains: [] },
	] },
};

describe("bundle popup actions", () => {
	it("keeps the selected bundle and URL scopes when rendering again", () => {
		const { actions, elements } = setup(); actions.render(context);
		elements.bundleSelect.value = "1"; elements.hostScope.value = "example.com"; elements.pathScope.value = "/projects";
		actions.render(context);
		expect(elements.bundleSelect.value).toBe("1"); expect(elements.hostScope.value).toBe("example.com"); expect(elements.pathScope.value).toBe("/projects"); expect(elements.bundleColor.textContent).toContain("red");
	});

	it("sends the canonical scoped entry with the displayed snapshot", async () => {
		const { actions, elements, sendMessage } = setup(); actions.render(context);
		elements.hostScope.value = "example.com"; elements.pathScope.value = "/projects";
		await elements.apply.emit("click");
		expect(sendMessage).toHaveBeenCalledWith({ type: "sumtabs:update-bundle-rule", operation: "add", bundleIndex: 0, expectedBundlesSnapshot: JSON.stringify(context.settings.customDomainGroups), entry: "example.com/projects" });
	});

	it("allows browsing and explicitly selected removal without a supported active URL", async () => {
		const { actions, elements, sendMessage } = setup(); actions.render({ ...context, url: "chrome://settings" });
		expect(elements.card.hidden).toBe(false); expect(elements.apply.disabled).toBe(true); expect(elements.remove.disabled).toBe(true);
		await elements.apply.emit("click"); expect(sendMessage).not.toHaveBeenCalled();
		elements.ruleSelect.value = "old.example.com"; await elements.ruleSelect.emit("change");
		expect(elements.remove.disabled).toBe(false); await elements.remove.emit("click");
		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ operation: "remove", entry: "old.example.com" }));
	});

	it("requires an explicit bundle selection after a stale refresh", async () => {
		let actions; const refreshed = { ...context, settings: { ...context.settings, customDomainGroups: [context.settings.customDomainGroups[1]] } };
		const refresh = vi.fn(async () => actions.render(refreshed));
		const setupResult = setup({ refresh }); ({ actions } = setupResult); const { elements, sendMessage } = setupResult;
		actions.render(context); elements.bundleSelect.value = "1"; await elements.bundleSelect.emit("change");
		sendMessage.mockResolvedValueOnce({ ok: false, status: "stale-bundles" }); await elements.apply.emit("click");
		expect(elements.bundleSelect.value).toBe(""); expect(elements.apply.disabled).toBe(true); expect(elements.remove.disabled).toBe(true);
		expect(elements.bundleColor.textContent).toBe("Choose a bundle to view its rules.");
	});

	it("preserves the mutation result when refreshing the view fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const { actions, elements, announce } = setup({ refresh: vi.fn().mockRejectedValue(new Error("read failed")) }); actions.render(context);
		await elements.apply.emit("click");
		expect(announce).toHaveBeenCalledWith(expect.stringContaining("Rule added"));
		expect(announce).toHaveBeenLastCalledWith(expect.stringContaining("popup view could not refresh"));
		consoleError.mockRestore();
	});

	it("preserves saved-reevaluation-failed when refreshing the view also fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const { actions, elements, announce, sendMessage } = setup({ refresh: vi.fn().mockRejectedValue(new Error("read failed")) });
		sendMessage.mockResolvedValue({ ok: false, status: "saved-reevaluation-failed" }); actions.render(context);
		await elements.apply.emit("click");
		expect(announce).toHaveBeenLastCalledWith(expect.stringContaining("open tabs could not be reorganized"));
		expect(announce).toHaveBeenLastCalledWith(expect.stringContaining("popup view could not refresh"));
		consoleError.mockRestore();
	});

	it("blocks a repeated submission while a mutation is pending", async () => {
		let resolve; const pending = new Promise((done) => { resolve = done; });
		const { actions, elements, sendMessage } = setup(); sendMessage.mockReturnValue(pending); actions.render(context);
		const first = elements.apply.emit("click"); await elements.apply.emit("click"); expect(sendMessage).toHaveBeenCalledTimes(1);
		resolve({ ok: true, status: "added" }); await first;
	});

	it("blocks other-bundle ownership and warns for path-prefix removal", async () => {
		const { actions, elements, sendMessage } = setup();
		const owned = { ...context, settings: { ...context.settings, customDomainGroups: [context.settings.customDomainGroups[0], { title: "Other", domains: ["docs.example.com", "docs.example.com/projects"] }] } };
		actions.render(owned); expect(elements.apply.disabled).toBe(true);
		elements.bundleSelect.value = "1"; await elements.bundleSelect.emit("change"); elements.ruleSelect.value = "docs.example.com/projects"; await elements.ruleSelect.emit("change");
		expect(elements.status.textContent).toContain("can affect other matching URLs"); expect(elements.remove.disabled).toBe(false);
		await elements.apply.emit("click"); expect(sendMessage).not.toHaveBeenCalled();
	});
});
