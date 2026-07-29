// @vitest-environment jsdom
//
// The selected-widget copy/cut branches in createTextClipboard: a selected inline
// widget (image, <br>) copies its own raw slice through e.clipboardData.setData,
// and cut additionally splices the slice out as one undoable commit. Real parse →
// getInlineContent resolution, a captured ClipboardEvent stand-in, and the real
// widget-selection state — no kind === 'image' branch (policy-agnostic).
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { parse } from '$lib/core/parser';
import {
	createTextClipboard,
	type TextClipboardDeps
} from '$lib/components/blocks/text/text-clipboard';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import type { CstNode } from '$lib/core/nodes';

interface Commit {
	index: number;
	raw: string;
	before: number;
	after: number;
}

function capturingEvent() {
	const store = new Map<string, string>();
	return {
		preventDefault: () => {},
		clipboardData: {
			setData: (type: string, value: string) => void store.set(type, value),
			getData: (type: string) => store.get(type) ?? ''
		},
		payload: () => store.get('text/plain') ?? ''
	};
}

function harness(source: string, sourceStart: number) {
	const node: CstNode = parse(source).children[0];
	const commits: Commit[] = [];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: sourceStart });

	const trap = new Proxy(
		{},
		{
			get() {
				throw new Error('unexpected dep access on the selected-widget clipboard path');
			}
		}
	);

	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		cursor: { getRaw: () => null, getRawSelection: () => null },
		selection: { isCrossBlock: false, anchor: null, focus: null },
		crossBlock: trap,
		stickyColumn: { reset: () => {} },
		blockEdit: {
			updateBlockContent: (index: number, raw: string, before: number, after: number) =>
				void commits.push({ index, raw, before, after })
		},
		pasteCoordinator: trap,
		getDoc: () => {
			throw new Error('unexpected getDoc access');
		},
		widgetSelection,
		setPendingCursor: () => {},
		isReadOnly: () => false,
		foldRevealBeforeMutation: () => null,
		get linkRef() {
			return undefined;
		}
	} as unknown as TextClipboardDeps;

	return { handlers: createTextClipboard(deps), commits, widgetSelection };
}

describe('createTextClipboard — selected-widget copy', () => {
	it('copies the widget raw slice and leaves the document and selection untouched', () => {
		const { handlers, commits, widgetSelection } = harness('lead![cat](x)\n', 4);
		const e = capturingEvent();
		handlers.onCopy(e as never);
		expect(e.payload()).toBe('![cat](x)');
		expect(commits).toEqual([]);
		expect(widgetSelection.getSelected()).not.toBeNull();
	});

	it('copies a widget at offset 0', () => {
		const { handlers } = harness('![a](x)trail\n', 0);
		const e = capturingEvent();
		handlers.onCopy(e as never);
		expect(e.payload()).toBe('![a](x)');
	});

	it('copies a non-image widget slice (policy-agnostic <br>)', () => {
		const { handlers } = harness('a<br>b\n', 1);
		const e = capturingEvent();
		handlers.onCopy(e as never);
		expect(e.payload()).toBe('<br>');
	});
});

describe('createTextClipboard — selected-widget cut', () => {
	it('copies the slice, splices it out as one commit, and clears the selection', async () => {
		const { handlers, commits, widgetSelection } = harness('lead![cat](x)\n', 4);
		const e = capturingEvent();
		await handlers.onCut(e as never);
		expect(e.payload()).toBe('![cat](x)');
		expect(commits).toHaveLength(1);
		expect(commits[0]).toEqual({ index: 0, raw: 'lead\n', before: 4, after: 4 });
		expect(widgetSelection.getSelected()).toBeNull();
	});

	it('cuts a widget at offset 0', async () => {
		const { handlers, commits } = harness('![a](x)trail\n', 0);
		const e = capturingEvent();
		await handlers.onCut(e as never);
		expect(e.payload()).toBe('![a](x)');
		expect(commits[0]).toEqual({ index: 0, raw: 'trail\n', before: 0, after: 0 });
	});
});

// A fold whose commit changes the block's kind takes the structural path, whose
// completion is a promise rather than a fixed number of ticks. Both clipboard
// mutations must hold until it lands, or they splice bytes the fold's own commit
// is still replacing.
function foldSettleHarness() {
	const node: CstNode = parse('lead![cat](x)\n').children[0];
	const order: string[] = [];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	widgetSelection.select({ paragraphPath: [0], sourceStart: 4, preSelectOffset: 4 });

	let releaseWrite!: () => void;
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});

	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		cursor: { getRaw: () => null, getRawSelection: () => null },
		selection: { isCrossBlock: false, anchor: null, focus: null },
		crossBlock: { handlePaste: async () => false, handleCut: async () => false },
		stickyColumn: { reset: () => {} },
		blockEdit: { updateBlockContent: () => void order.push('seam-commit') },
		pasteCoordinator: {},
		getDoc: () => null,
		widgetSelection,
		setPendingCursor: () => {},
		isReadOnly: () => false,
		foldRevealBeforeMutation: () => ({
			caret: 4,
			settled: writeGate.then(() => void order.push('fold-write'))
		}),
		get linkRef() {
			return undefined;
		}
	} as unknown as TextClipboardDeps;

	return { handlers: createTextClipboard(deps), order, releaseWrite };
}

describe('createTextClipboard — a mutation waits for the reveal fold it triggered', () => {
	it('holds the cut splice until the fold’s write settles', async () => {
		const { handlers, order, releaseWrite } = foldSettleHarness();
		const cut = handlers.onCut(capturingEvent() as never);
		await tick();
		await tick();

		expect(order).toEqual([]);

		releaseWrite();
		await cut;
		expect(order).toEqual(['fold-write', 'seam-commit']);
	});

	it('holds the paste splice until the fold’s write settles', async () => {
		const { handlers, order, releaseWrite } = foldSettleHarness();
		const e = capturingEvent();
		e.clipboardData.setData('text/plain', 'pasted');
		const paste = handlers.onPaste(e as never);
		await tick();
		await tick();

		expect(order).toEqual([]);

		releaseWrite();
		await paste;
		expect(order).toEqual(['fold-write', 'seam-commit']);
	});
});
