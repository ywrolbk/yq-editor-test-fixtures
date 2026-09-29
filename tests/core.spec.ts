import { describe, it, expect, vi, afterEach } from "vitest";
import {
	mountLakeEditor,
	resolveUploadConfig,
	loadLakeEditor,
	templateHtml,
	type LakeEditorInstance,
} from "../src/core";
import {
	FakeEditor,
	createFakeDoc,
	createFakeWin,
	createFakeIframe,
	flush,
} from "./helpers/fake-lake";

type Options = Parameters<typeof mountLakeEditor>[1];

async function mountFake(options: Partial<Options> = {}) {
	const editor = new FakeEditor();
	const doc = createFakeDoc();
	const win = createFakeWin(doc, editor);
	const iframe = createFakeIframe(doc, win);
	const promise = mountLakeEditor(
		iframe as unknown as HTMLIFrameElement,
		options as Options
	);
	iframe.dispatch("load");
	const api = (await promise) as LakeEditorInstance;
	return { editor, doc, win, iframe, api };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveUploadConfig", () => {
	it("applies documented defaults when nothing is provided", () => {
		expect(resolveUploadConfig({})).toEqual({
			imageUploadURL: "/api/upload/image",
			imageCrawlURL: "/api/upload/image",
			videoUploadURL: "/api/upload/video",
			uploadImage: undefined,
			uploadVideo: undefined,
		});
	});

	it("reads the nested upload object", () => {
		const uploadImage = vi.fn();
		const uploadVideo = vi.fn();
		expect(
			resolveUploadConfig({
				upload: {
					imageUploadURL: "/nested/img",
					imageCrawlURL: "/nested/crawl",
					videoUploadURL: "/nested/video",
					uploadImage,
					uploadVideo,
				},
			})
		).toEqual({
			imageUploadURL: "/nested/img",
			imageCrawlURL: "/nested/crawl",
			videoUploadURL: "/nested/video",
			uploadImage,
			uploadVideo,
		});
	});

	it("defaults crawl URL to the resolved image upload URL from the same source", () => {
		expect(resolveUploadConfig({ upload: { imageUploadURL: "/nested/img" } }))
			.toEqual({
				imageUploadURL: "/nested/img",
				imageCrawlURL: "/nested/img",
				videoUploadURL: "/api/upload/video",
				uploadImage: undefined,
				uploadVideo: undefined,
			});
		expect(resolveUploadConfig({ imageUploadURL: "/flat/img" })).toEqual({
			imageUploadURL: "/flat/img",
			imageCrawlURL: "/flat/img",
			videoUploadURL: "/api/upload/video",
			uploadImage: undefined,
			uploadVideo: undefined,
		});
	});

	it("gives flat fields precedence over nested fields per key", () => {
		const flatImage = vi.fn();
		const nestedImage = vi.fn();
		const nestedVideo = vi.fn();
		expect(
			resolveUploadConfig({
				imageUploadURL: "/flat/img",
				imageCrawlURL: undefined,
				videoUploadURL: undefined,
				uploadImage: flatImage,
				upload: {
					imageUploadURL: "/nested/img",
					imageCrawlURL: "/nested/crawl",
					videoUploadURL: "/nested/video",
					uploadImage: nestedImage,
					uploadVideo: nestedVideo,
				},
			})
		).toEqual({
			imageUploadURL: "/flat/img",
			imageCrawlURL: "/nested/crawl",
			videoUploadURL: "/nested/video",
			uploadImage: flatImage,
			uploadVideo: nestedVideo,
		});
	});

	it("keeps explicitly provided empty strings as values", () => {
		const config = resolveUploadConfig({
			imageUploadURL: "",
			upload: { imageUploadURL: "/nested/img" },
		});
		expect(config.imageUploadURL).toBe("");
		expect(config.imageCrawlURL).toBe("");
	});

	it("merges partial nested upload config with flat fields", () => {
		const uploadVideo = vi.fn();
		expect(
			resolveUploadConfig({
				uploadVideo,
				upload: { imageUploadURL: "/nested/img" },
			})
		).toEqual({
			imageUploadURL: "/nested/img",
			imageCrawlURL: "/nested/img",
			videoUploadURL: "/api/upload/video",
			uploadImage: undefined,
			uploadVideo,
		});
	});
});

describe("mountLakeEditor", () => {
	it("attaches the load listener and assigns srcdoc before the iframe loads", () => {
		const editor = new FakeEditor();
		const doc = createFakeDoc();
		const win = createFakeWin(doc, editor);
		const iframe = createFakeIframe(doc, win);
		const promise = mountLakeEditor(
			iframe as unknown as HTMLIFrameElement,
			{} as Options
		);
		expect(iframe.srcdoc).toBe(templateHtml);
		expect(iframe.listeners.get("load")?.size).toBe(1);
		iframe.dispatch("load");
		return expect(promise).resolves.toBeTruthy();
	});

	it("rejects when the iframe document is not available", async () => {
		const editor = new FakeEditor();
		const doc = createFakeDoc();
		const win = createFakeWin(doc, editor);
		const iframe = createFakeIframe(null, win);
		const promise = mountLakeEditor(
			iframe as unknown as HTMLIFrameElement,
			{} as Options
		);
		iframe.dispatch("load");
		await expect(promise).rejects.toThrow("iframe document is not available");
	});

	it("creates an editor with resolved defaults and exposes the raw editor", async () => {
		const { editor, doc, win, iframe, api } = await mountFake();
		expect(win.Doc.createOpenEditor).toHaveBeenCalledTimes(1);
		expect(doc.elementIds).toContain("root");
		const [container, options] = (win.Doc.createOpenEditor as any).mock
			.calls[0];
		expect(container).toEqual({ id: "root" });
		expect(options.placeholder).toBe("输入内容...");
		expect(options.defaultFontsize).toBe(14);
		expect(options.image).toEqual({
			uploadFileURL: "/api/upload/image",
			crawlURL: "/api/upload/image",
		});
		expect(options.video).toEqual({ uploadFileURL: "/api/upload/video" });
		expect(options.scrollNode()).toEqual({ selector: ".ne-editor-wrap" });
		expect(doc.queries).toContain(".ne-editor-wrap");
		expect(win.editor).toBe(editor);
		expect(api.getRawEditor()).toBe(editor);
		expect(iframe.focusCount).toBe(0);
		expect(win.Doc.OpenEditorFactory.registerKernelPlugin).toHaveBeenCalled();
	});

	it("uses custom placeholder, font size and upload handlers", async () => {
		const uploadImage = vi.fn(async () => ({
			url: "u",
			size: 1,
			filename: "f",
		}));
		const uploadVideo = vi.fn(async () => ({
			url: "v",
			size: 2,
			filename: "g",
		}));
		const { win } = await mountFake({
			placeholder: "写点什么",
			defaultFontsize: 16,
			uploadImage,
			uploadVideo,
		});
		const options = (win.Doc.createOpenEditor as any).mock.calls[0][1];
		expect(options.placeholder).toBe("写点什么");
		expect(options.defaultFontsize).toBe(16);
		expect(options.image.createUploadPromise).toBe(uploadImage);
		expect(options.video.createUploadPromise).toBe(uploadVideo);
	});

	it("resolves flat and nested upload config when creating the editor", async () => {
		const { win } = await mountFake({
			imageUploadURL: "/flat/img",
			upload: { imageUploadURL: "/nested/img", videoUploadURL: "/nested/video" },
		});
		const options = (win.Doc.createOpenEditor as any).mock.calls[0][1];
		expect(options.image.uploadFileURL).toBe("/flat/img");
		expect(options.image.crawlURL).toBe("/flat/img");
		expect(options.video.uploadFileURL).toBe("/nested/video");
	});

	it("uses the viewer factory and skips change handling in view mode", async () => {
		const { editor, win, api } = await mountFake({ isview: true, value: "v" });
		expect(win.Doc.createOpenViewer).toHaveBeenCalledTimes(1);
		expect(win.Doc.createOpenEditor).not.toHaveBeenCalled();
		expect(editor.handlers.has("contentchange")).toBe(false);
		expect(editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "v"],
		]);
		expect(editor.getCallsOf("execCommand")).toEqual([]);
		expect(api.isEmpty()).toBe(false);
	});

	it("sets the initial value only when present and relaxes paragraph spacing in edit mode", async () => {
		const first = await mountFake({ value: "" });
		expect(first.editor.getCallsOf("setDocument")).toEqual([]);
		const second = await mountFake({ value: "hello" });
		expect(second.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "hello"],
		]);
		expect(second.editor.getCallsOf("execCommand")).toEqual([
			["execCommand", "paragraphSpacing", "relax"],
		]);
	});

	it("emits onLoad after mounting and opens links in a new tab", async () => {
		const onLoad = vi.fn();
		const open = vi.spyOn(window, "open").mockImplementation(() => null);
		const { editor } = await mountFake({ onLoad });
		expect(onLoad).toHaveBeenCalledTimes(1);
		editor.emit("visitLink", "https://example.com");
		expect(open).toHaveBeenCalledWith("https://example.com", "__blank");
	});

	it("reports changes with full lake document and ignores self-triggered updates", async () => {
		const seen: string[] = [];
		let api: LakeEditorInstance | undefined;
		const onChange = vi.fn((value: string) => {
			seen.push(value);
			api?.setValue("during-change");
		});
		const mounted = await mountFake({ value: "init", onChange });
		api = mounted.api;
		mounted.editor.documents["text/lake"] = "current";
		mounted.editor.emit("contentchange");
		expect(onChange).toHaveBeenCalledWith("current");
		expect(seen).toEqual(["current"]);
		expect(mounted.editor.calls).toContainEqual([
			"getDocument",
			"text/lake",
			{ includeMeta: true },
		]);
		expect(mounted.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "init"],
		]);
		await flush();
		api.setValue("later");
		expect(mounted.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "init"],
			["setDocument", "lake", "later"],
		]);
		expect(mounted.editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"paragraphSpacing",
			"relax",
		]);
	});

	it("setValue is a no-op when the content is unchanged and in view mode", async () => {
		const edit = await mountFake({ value: "same" });
		edit.editor.documents["text/lake"] = "same";
		edit.api.setValue("same");
		expect(edit.editor.getCallsOf("setDocument")).toHaveLength(1);

		const view = await mountFake({ isview: true, value: "same" });
		view.editor.documents["text/lake"] = "same";
		view.api.setValue("other");
		expect(view.editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "lake", "same"],
			["setDocument", "lake", "other"],
		]);
		expect(view.editor.getCallsOf("execCommand")).toEqual([]);
	});

	it("fires onSave on ctrl/meta+Enter via the iframe keydown listener", async () => {
		const onSave = vi.fn();
		const { doc } = await mountFake({ onSave });
		expect(doc.listeners.get("keydown")?.size).toBe(1);
		doc.fire("keydown", { key: "a", ctrlKey: true });
		doc.fire("keydown", { key: "Enter", ctrlKey: false });
		expect(onSave).not.toHaveBeenCalled();
		doc.fire("keydown", { key: "Enter", ctrlKey: true });
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it("implements appendContent, insertBreakLine, focusToStart and counts", async () => {
		const { editor, iframe, api } = await mountFake();
		api.appendContent("<p>x</p>");
		expect(editor.kernel.commands).toEqual([["insertHTML", "<p>x</p>"]]);
		expect(iframe.focusCount).toBe(1);
		expect(editor.getCallsOf("execCommand")).toEqual([
			["execCommand", "focus", undefined],
		]);
		expect(editor.rendererCalls).toBe(1);

		api.appendContent("<p>y</p>", true);
		expect(editor.getCallsOf("execCommand")).toContainEqual([
			"execCommand",
			"breakLine",
			undefined,
		]);

		api.insertBreakLine();
		expect(editor.getCallsOf("execCommand").filter((c) => c[1] === "breakLine")).toHaveLength(2);

		api.focusToStart();
		expect(editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"focus",
			"start",
		]);

		const child = { childCount: 3 };
		editor.rootNode.children = [{ childCount: 0 }, { childCount: 1 }, child];
		api.focusToStart(2);
		expect(editor.kernel.commands.at(-1)).toEqual([
			"selection",
			{
				ranges: [{ start: { node: child, offset: 0 } }],
			},
		]);
		expect(editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"focus",
			undefined,
		]);

		expect(api.isEmpty()).toBe(false);
		expect(api.getSummaryContent()).toBe("summary");
		expect(api.wordCount()).toBe(7);
		expect(api.getContent("lake")).toBe("DOC:text/lake");
		expect(api.getContent("text/html")).toBe("DOC:text/html");
		expect(api.getContent("description")).toBe("DOC:description");
	});

	it("setContent sets the document, focuses the end and handles the anchor block", async () => {
		const { editor, iframe, api } = await mountFake();
		api.setContent("<p>hi</p>");
		expect(editor.getCallsOf("setDocument")).toEqual([
			["setDocument", "text/html", "<p>hi</p>"],
		]);
		expect(editor.getCallsOf("execCommand")).toEqual([
			["execCommand", "focus", "end"],
		]);
		expect(iframe.focusCount).toBe(1);

		api.setContent("{}", "text/lake");
		expect(editor.calls).toContainEqual(["setDocument", "text/lake", "{}"]);

		// anchor node is the first node: no extra selection is applied
		const anchor = { id: "anchor", offset: 1 };
		editor.rootNode.firstNode = anchor;
		editor.nodeById = anchor;
		const before = editor.kernel.commands.length;
		api.setContent("anchor content");
		expect(editor.kernel.commands.length).toBe(before);

		// anchor node deeper in the tree: place the caret at the end of the previous block
		const prev = { id: "prev" };
		editor.rootNode.firstNode = prev;
		const anchor2 = { id: "anchor2", offset: 2, childCount: 4 };
		editor.rootNode.children = [prev, anchor2];
		editor.nodeById = anchor2;
		api.setContent("anchor content 2");
		expect(editor.kernel.commands.at(-1)).toEqual([
			"selection",
			{ ranges: [{ start: { node: anchor2, offset: 4 } }] },
		]);
		expect(editor.getCallsOf("execCommand").at(-1)).toEqual([
			"execCommand",
			"focus",
			undefined,
		]);
	});

	it("destroy removes listeners and makes the instance inert", async () => {
		const { editor, doc, iframe, api, win } = await mountFake({ value: "x" });
		api.destroy();
		expect(iframe.removals.map((r) => r[1])).toContain("load");
		expect(doc.removals).toContainEqual([
			"removeEventListener",
			"keydown",
			expect.any(Function),
		]);
		expect(doc.listeners.get("keydown")?.size ?? 0).toBe(0);

		const docCalls = editor.calls.length;
		api.setValue("y");
		api.appendContent("<b>z</b>");
		api.setContent("q");
		api.focusToStart(1);
		api.insertBreakLine();
		expect(editor.calls.length).toBe(docCalls);
		expect(api.isEmpty()).toBe(true);
		expect(api.getContent("lake")).toBe("");
		expect(api.getSummaryContent()).toBe("");
		expect(api.wordCount()).toBe(0);

		iframe.dispatch("load");
		expect(win.Doc.createOpenEditor).toHaveBeenCalledTimes(1);
	});
});

describe("loadLakeEditor", () => {
	afterEach(() => vi.useRealTimers());

	it("resolves immediately when Doc is already available", async () => {
		const win: any = { Doc: { marker: true } };
		await expect(loadLakeEditor(win)).resolves.toBe(win.Doc);
	});

	it("resolves once Doc appears", async () => {
		vi.useFakeTimers();
		const win: any = {};
		const promise = loadLakeEditor(win);
		await vi.advanceTimersByTimeAsync(500);
		win.Doc = { marker: true };
		await vi.advanceTimersByTimeAsync(200);
		await expect(promise).resolves.toBe(win.Doc);
	});

	it("rejects with the timeout error after 10 seconds", async () => {
		vi.useFakeTimers();
		const promise = loadLakeEditor({} as any);
		const assertion = expect(promise).rejects.toThrow(
			"load lake editor timeout"
		);
		await vi.advanceTimersByTimeAsync(10_100);
		await assertion;
	});
});
