import { vi } from "vitest";

export type Call = [string, ...any[]];

export class FakeEditor {
	handlers = new Map<string, Function[]>();
	calls: Call[] = [];
	documents: Record<string, any> = {};
	queryReturns: Record<string, any> = {
		isEmpty: false,
		getSummary: "summary",
		wordCount: 7,
	};
	rendererCalls = 0;
	rootNode: any = { firstNode: null, children: [] };
	nodeById: any = undefined;
	kernel: any;
	renderer: any;

	constructor() {
		const self = this;
		this.kernel = {
			commands: [] as Call[],
			execCommand: (cmd: string, arg?: any) => {
				self.kernel.commands.push([cmd, arg]);
			},
			model: {
				document: {
					get rootNode() {
						return self.rootNode;
					},
					getNodeById: (_id: string) => self.nodeById,
				},
			},
		};
		this.renderer = {
			scrollToCurrentSelection: () => {
				self.rendererCalls++;
			},
		};
	}

	on(type: string, handler: Function) {
		const list = this.handlers.get(type) ?? [];
		list.push(handler);
		this.handlers.set(type, list);
	}

	emit(type: string, ...args: any[]) {
		for (const handler of this.handlers.get(type) ?? []) {
			handler(...args);
		}
	}

	getDocument(type: string, options?: any) {
		this.calls.push(["getDocument", type, options]);
		if (type in this.documents) return this.documents[type];
		return `DOC:${type}`;
	}

	setDocument(type: string, content: any) {
		this.calls.push(["setDocument", type, content]);
		this.documents[type] = content;
	}

	execCommand(cmd: string, arg?: any) {
		this.calls.push(["execCommand", cmd, arg]);
	}

	queryCommandValue(cmd: string, arg?: any) {
		this.calls.push(["queryCommandValue", cmd, arg]);
		return this.queryReturns[cmd];
	}

	getCallsOf(name: string) {
		return this.calls.filter((c) => c[0] === name);
	}
}

export interface FakeDocMock {
	elementIds: string[];
	queries: string[];
	listeners: Map<string, Set<Function>>;
	removals: Call[];
	getElementById: (id: string) => any;
	querySelector: (selector: string) => any;
	addEventListener: (type: string, handler: Function, options?: any) => void;
	removeEventListener: (type: string, handler: Function, options?: any) => void;
	fire: (type: string, event?: any) => void;
}

export function createFakeDoc(): FakeDocMock {
	const listeners = new Map<string, Set<Function>>();
	const removals: Call[] = [];
	const doc: FakeDocMock = {
		elementIds: [],
		queries: [],
		listeners,
		removals,
		getElementById(id: string) {
			doc.elementIds.push(id);
			return { id };
		},
		querySelector(selector: string) {
			doc.queries.push(selector);
			return { selector };
		},
		addEventListener(type, handler) {
			const set = listeners.get(type) ?? new Set();
			set.add(handler);
			listeners.set(type, set);
		},
		removeEventListener(type, handler) {
			removals.push(["removeEventListener", type, handler]);
			listeners.get(type)?.delete(handler);
		},
		fire(type, event) {
			for (const handler of listeners.get(type) ?? []) handler(event);
		},
	};
	return doc;
}

export function createFakeWin(doc: FakeDocMock, editor: FakeEditor) {
	const docNamespace: any = {
		createOpenEditor: vi.fn(() => editor),
		createOpenViewer: vi.fn(() => editor),
		EditorPlugin: class {},
		KernelPlugin: class {},
		Command: class {},
		PositionUtil: {},
		SelectionUtil: {},
		toolbarItems: {},
		Plugins: {},
		OpenEditorFactory: {
			editorPlugins: [],
			kernelPlugins: [] as any[],
			registerKernelPlugin: vi.fn(),
			registerEditorPlugin: vi.fn(),
			registerRenderPlugin: vi.fn(),
		},
	};
	const win: any = {
		Doc: docNamespace,
		document: doc,
	};
	return win;
}

export interface FakeIframe {
	srcdoc: string;
	contentDocument: any;
	contentWindow: any;
	focusCount: number;
	listeners: Map<string, Set<Function>>;
	removals: Call[];
	addEventListener: (type: string, handler: Function) => void;
	removeEventListener: (type: string, handler: Function) => void;
	focus: () => void;
	dispatch: (type: string, event?: any) => void;
}

export function createFakeIframe(doc: any, win: any): FakeIframe {
	const listeners = new Map<string, Set<Function>>();
	const removals: Call[] = [];
	const iframe: FakeIframe = {
		srcdoc: "",
		contentDocument: doc,
		contentWindow: win,
		focusCount: 0,
		listeners,
		removals,
		addEventListener(type, handler) {
			const set = listeners.get(type) ?? new Set();
			set.add(handler);
			listeners.set(type, set);
		},
		removeEventListener(type, handler) {
			removals.push(["removeEventListener", type, handler]);
			listeners.get(type)?.delete(handler);
		},
		focus() {
			iframe.focusCount++;
		},
		dispatch(type, event) {
			for (const handler of [...(listeners.get(type) ?? [])]) {
				handler(event);
			}
		},
	};
	return iframe;
}

export async function flush() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
