import { describe, expect, it, vi } from "vitest";

import { createBundleActions } from "../../src/popup/bundle-actions.js";

class FakeElement {
	constructor(ownerDocument) {
		this.ownerDocument = ownerDocument;
		this.children = [];
		this.listeners = {};
		this.value = "";
		this.textContent = "";
		this.disabled = false;
		this.hidden = false;
		this.style = { setProperty: (name, value) => { this.style[name] = value; } };
	}
	appendChild(child) {
		this.children.push(child);
		if (!this.value && child.value !== undefined) this.value = child.value;
		return child;
	}
	replaceChildren(...children) {
		this.children = children;
		this.value = children[0]?.value ?? "";
	}
	addEventListener(type, listener) {
		(this.listeners[type] ??= []).push(listener);
	}
	async emit(type) {
		for (const listener of this.listeners[type] ?? []) await listener();
	}
	setAttribute(name, value) {
		this[name] = value;
	}
}

function setup() {
	const documentRef = { createElement: () => new FakeElement(documentRef) };
	const elements = Object.fromEntries(
		[
			"card", "bundleSelect", "bundleColor", "hostScope", "pathScope",
			"preview", "ruleSelect", "status", "apply", "remove", "openSettings",
		].map((key) => [key, new FakeElement(documentRef)]),
	);
	const sendMessage = vi.fn().mockResolvedValue({ ok: true, status: "added" });
	const refresh = vi.fn();
	const announce = vi.fn();
	const actions = createBundleActions({
		chromeApi: { runtime: { sendMessage, openOptionsPage: vi.fn() } },
		elements,
		announce,
		refresh,
	});
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
		const { actions, elements } = setup();
		actions.render(context);
		elements.bundleSelect.value = "1";
		elements.hostScope.value = "example.com";
		elements.pathScope.value = "/projects";
		actions.render(context);
		expect(elements.bundleSelect.value).toBe("1");
		expect(elements.hostScope.value).toBe("example.com");
		expect(elements.pathScope.value).toBe("/projects");
		expect(elements.bundleColor.textContent).toContain("red");
	});

	it("sends the canonical scoped entry with the displayed snapshot", async () => {
		const { actions, elements, sendMessage } = setup();
		actions.render(context);
		elements.hostScope.value = "example.com";
		elements.pathScope.value = "/projects";
		await elements.apply.emit("click");
		expect(sendMessage).toHaveBeenCalledWith({
			type: "sumtabs:update-bundle-rule",
			operation: "add",
			bundleIndex: 0,
			expectedBundlesSnapshot: JSON.stringify(context.settings.customDomainGroups),
			entry: "example.com/projects",
		});
	});

	it("allows browsing and stored-rule removal without a supported active URL", async () => {
		const { actions, elements, sendMessage } = setup();
		actions.render({ ...context, url: "chrome://settings" });
		expect(elements.card.hidden).toBe(false);
		expect(elements.apply.disabled).toBe(true);
		expect(elements.ruleSelect.children[0].textContent).toBe("old.example.com");
		await elements.remove.emit("click");
		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
			operation: "remove",
			entry: "old.example.com",
		}));
	});
});
