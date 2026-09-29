import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { YuqueRichText, YuqueRichTextView } from "../src/vue";
import LegacyYuqueRichText from "../src/components/lake-rich/lake-rich";
import {
	FakeEditor,
	createFakeDoc,
	createFakeWin,
	createFakeIframe,
	flush,
} from "./helpers/fake-lake";

interface Installed {
	editor: FakeEditor;
	doc: ReturnType<typeof createFakeDoc>;
	win: any;
	fake: ReturnType<typeof createFakeIframe>;
	element?: HTMLIFrameElement;
}

function fireLoad(record: Installed) {
	record.element?.dispatchEvent(new Event("load"));
}

let restoreCreateElement: (() => void) | undefined;
let installed: Installed[] = [];

function installFakeIframes() {
	installed = [];
	const original = document.createElement.bind(document);
	const spy = vi
		.spyOn(document, "createElement")
		.mockImplementation(((tag: string, ...args: any[]) => {
			const el: any = original(tag, ...args);
			if (String(tag).toLowerCase() === "iframe") {
				const editor = new FakeEditor();
				const doc = createFakeDoc();
				const win = createFakeWin(doc, editor);
				const fake = createFakeIframe(doc, win);
				const record: Installed = { editor, doc, win, fake };
				Object.defineProperty(el, "contentDocument", {
					configurable: true,
					get: () => record.fake.contentDocument,
				});
				Object.defineProperty(el, "contentWindow", {
					configurable: true,
					get: () => record.fake.contentWindow,
				});
				Object.defineProperty(el, "srcdoc", {
					configurable: true,
					get: () => record.fake.srcdoc,
					set: (value: string) => {
						record.fake.srcdoc = value;
					},
				});
				record.element = el;
				installed.push(record);
			}
			return el;
		}) as any);
	restoreCreateElement = () => spy.mockRestore();
}

async function mountEditor(props: Record<string, any> = {}) {
	installFakeIframes();
	const wrapper = mount(YuqueRichText, {
		attachTo: document.body,
		props,
	});
	if (!installed.length) throw new Error("no iframe was created");
	fireLoad(installed[0]);
	await flush();
	await flush();
	return { wrapper, env: installed[0] };
}

afterEach(() => {
	restoreCreateElement?.();
	restoreCreateElement = undefined;
	installed = [];
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("Vue adapter", () => {
	it("renders the editor iframe into the mounted element", async () => {
		const { wrapper, env } = await mountEditor({ value: "hello" });
		expect(wrapper.get("iframe").classes()).toContain("lake-editor");
		expect(env.fake.srcdoc).not.toBe("");
		expect(env.win.editor).toBe(env.editor);
	});

	it("forwards flat and nested upload configuration to the core", async () => {
		const { env } = await mountEditor({
			value: "",
			imageUploadURL: "/flat/image",
			imageCrawlURL: "/flat/crawl",
			upload: { videoUploadURL: "/nested/video" },
		});
		const [container, options] = (env.win.Doc.createOpenEditor as any).mock
			.calls[0];
		expect(container).toBeTruthy();
		expect(options.image.uploadFileURL).toBe("/flat/image");
		expect(options.image.crawlURL).toBe("/flat/crawl");
		expect(options.video.uploadFileURL).toBe("/nested/video");
	});

	it("applies placeholder and defaultFontsize props", async () => {
		const { env } = await mountEditor({
			placeholder: "请写内容",
			defaultFontsize: 18,
		});
		const options = (env.win.Doc.createOpenEditor as any).mock.calls[0][1];
		expect(options.placeholder).toBe("请写内容");
		expect(options.defaultFontsize).toBe(18);
	});

	it("uses the documented defaults when no props are passed", async () => {
		const { env } = await mountEditor();
		const options = (env.win.Doc.createOpenEditor as any).mock.calls[0][1];
		expect(options.placeholder).toBe("输入内容...");
		expect(options.defaultFontsize).toBe(14);
		expect(options.image.uploadFileURL).toBe("/api/upload/image");
		expect(options.video.uploadFileURL).toBe("/api/upload/video");
	});

	it("emits onChange and update:value with the lake document", async () => {
		const { wrapper, env } = await mountEditor({ value: "init" });
		env.editor.documents["text/lake"] = "changed-doc";
		env.editor.emit("contentchange");
		expect(wrapper.emitted("onChange")).toEqual([["changed-doc"]]);
		expect(wrapper.emitted("update:value")).toEqual([["changed-doc"]]);
	});

	it("emits onLoad once and onSave on ctrl+Enter", async () => {
		const { wrapper, env } = await mountEditor();
		expect(wrapper.emitted("onLoad")).toHaveLength(1);
		env.doc.fire("keydown", { key: "Enter", ctrlKey: true });
		expect(wrapper.emitted("onSave")).toHaveLength(1);
		env.doc.fire("keydown", { key: "s", ctrlKey: true });
		expect(wrapper.emitted("onSave")).toHaveLength(1);
	});

	it("exposes the editor API and defaults before mount completes", async () => {
		installFakeIframes();
		const wrapper = mount(YuqueRichText, {
			attachTo: document.body,
			props: { value: "" },
		});
		const vm: any = wrapper.vm;
		expect(vm.getContent("lake")).toBe("");
		expect(vm.isEmpty()).toBe(true);
		expect(vm.getSummaryContent()).toBe("");
		expect(vm.wordCount()).toBe(0);
		expect(vm.getContent("text/html")).toBe("");

		fireLoad(installed[0]);
		await flush();
		await flush();

		const env = installed[0];
		env.editor.documents["text/lake"] = "lake-doc";
		env.editor.documents["text/html"] = "<p>html</p>";
		env.editor.documents["description"] = "desc";
		env.editor.queryReturns.isEmpty = false;
		env.editor.queryReturns.getSummary = "sum";
		env.editor.queryReturns.wordCount = 12;

		expect(vm.getContent("lake")).toBe("lake-doc");
		expect(vm.getContent("text/html")).toBe("<p>html</p>");
		expect(vm.getContent("description")).toBe("desc");
		expect(vm.isEmpty()).toBe(false);
		expect(vm.getSummaryContent()).toBe("sum");
		expect(vm.wordCount()).toBe(12);

		vm.appendContent("<b>x</b>", true);
		expect(env.editor.kernel.commands).toEqual([["insertHTML", "<b>x</b>"]]);
		expect(env.editor.getCallsOf("execCommand")[0]).toEqual([
			"execCommand",
			"breakLine",
			undefined,
		]);

		vm.setContent("<p>y</p>");
		expect(env.editor.calls).toContainEqual([
			"setDocument",
			"text/html",
			"<p>y</p>",
		]);

		vm.insertBreakLine();
		vm.focusToStart();
		expect(env.editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"focus",
			"start",
		]);
		wrapper.unmount();
	});

	it("syncs external value changes through setValue", async () => {
		const { wrapper, env } = await mountEditor({ value: "one" });
		env.editor.documents["text/lake"] = "one";
		await wrapper.setProps({ value: "two" });
		await flush();
		expect(env.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "one"],
			["setDocument", "lake", "two"],
		]);
		expect(env.editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"paragraphSpacing",
			"relax",
		]);
	});

	it("destroys the instance and removes listeners on unmount", async () => {
		const { wrapper, env } = await mountEditor({ value: "x" });
		const removeSpy = vi.spyOn(env.element!, "removeEventListener");
		wrapper.unmount();
		expect(removeSpy).toHaveBeenCalledWith("load", expect.any(Function));
		expect(env.doc.listeners.get("keydown")?.size ?? 0).toBe(0);
		expect(env.doc.removals.map((r) => r[1])).toContain("keydown");
	});

	it("mounts the legacy path as the same Vue editor", async () => {
		installFakeIframes();
		const wrapper = mount(LegacyYuqueRichText as any, {
			attachTo: document.body,
			props: { value: "legacy" },
		});
		fireLoad(installed[0]);
		await flush();
		await flush();
		expect(installed[0].win.Doc.createOpenEditor).toHaveBeenCalledTimes(1);
		expect(wrapper.get("iframe").classes()).toContain("lake-editor");
		wrapper.unmount();
	});
});

describe("YuqueRichTextView", () => {
	it("forces viewer mode and emits onLoad", async () => {
		installFakeIframes();
		const wrapper = mount(YuqueRichTextView, {
			attachTo: document.body,
			props: { value: "reading" },
		});
		fireLoad(installed[0]);
		await flush();
		await flush();
		const env = installed[0];
		expect(env.win.Doc.createOpenViewer).toHaveBeenCalledTimes(1);
		expect(env.win.Doc.createOpenEditor).not.toHaveBeenCalled();
		expect(env.editor.handlers.has("contentchange")).toBe(false);
		expect(wrapper.emitted("onLoad")).toHaveLength(1);
		expect(env.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "reading"],
		]);
		wrapper.unmount();
	});
});
