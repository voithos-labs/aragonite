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
import type { Commit } from './widget-selected-fixture';

function capturingEvent() {
	const store = new Map<string, string>();
	return {
		preventDefault: () => {},
		clipboardData: {
			setData: (type: string, value: string) => void store.set(type, value),
			getData: (type: string) => store.get(type) ?? ''
		},
		payload: () => store.get('text/plain') ?? '',
		/** Distinguishes a handler that wrote nothing from one that never ran at all. */
		wrote: () => store.has('text/plain')
	};
}

interface HarnessOptions {
	/** Omitted selection stands in for a widget selected on a DIFFERENT block. */
	selectWidget?: boolean;
	readOnly?: boolean;
	/** The paste route consults the cross-block seam before the widget arm; every other
	 *  route leaves the trap in place, which is what proves it never fell through. */
	crossBlockDeclines?: boolean;
}

function harness(source: string, sourceStart: number, options: HarnessOptions = {}) {
	const node: CstNode = parse(source).children[0];
	const commits: Commit[] = [];
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	if (options.selectWidget !== false) {
		widgetSelection.select({ paragraphPath: [0], sourceStart, preSelectOffset: sourceStart });
	}

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
		crossBlock: options.crossBlockDeclines ? { handlePaste: async () => false } : trap,
		stickyColumn: { reset: () => {} },
		edgeAffinity: { reset: () => {}, get: () => null, note: () => {}, noteTyping: () => {} },
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
		isReadOnly: () => options.readOnly === true,
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

// The root seam's arm: the browser dispatches at <body> when the paragraph holds no text
// position, and the editor root hands the event back here. Forwarding to the same handlers the
// caret route reaches is what carries the reading gate and the sticky reset along with it.
describe('createTextClipboard — claimRootClipboard', () => {
	it('routes each clipboard type to the arm the caret route reaches', async () => {
		const copy = harness('lead![cat](x)\n', 4);
		const copyEvent = capturingEvent();
		copy.handlers.claimRootClipboard({ ...copyEvent, type: 'copy' } as never);
		expect(copyEvent.payload()).toBe('![cat](x)');
		expect(copy.commits).toEqual([]);

		const cut = harness('lead![cat](x)\n', 4);
		const cutEvent = capturingEvent();
		cut.handlers.claimRootClipboard({ ...cutEvent, type: 'cut' } as never);
		await tick();
		expect(cutEvent.payload()).toBe('![cat](x)');
		expect(cut.commits[0]).toEqual({ index: 0, raw: 'lead\n', before: 4, after: 4 });

		const paste = harness('lead![cat](x)\n', 4, { crossBlockDeclines: true });
		const pasteEvent = capturingEvent();
		pasteEvent.clipboardData.setData('text/plain', 'PASTED');
		paste.handlers.claimRootClipboard({ ...pasteEvent, type: 'paste' } as never);
		await tick();
		expect(paste.commits[0].raw).toBe('leadPASTED\n');
	});

	// The trap deps prove it: the guard must not reach a handler, or the block would answer
	// for a widget selected somewhere else.
	it('stays inert when the selected widget is not this block’s', () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4, { selectWidget: false });
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'copy' } as never);
		expect(event.wrote()).toBe(false);
		expect(commits).toEqual([]);
	});

	it('stays inert for an event type no arm owns', () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4);
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'beforeinput' } as never);
		expect(event.wrote()).toBe(false);
		expect(commits).toEqual([]);
	});

	// Reading mode degrades the cut to the copy path, which writes the visible selection
	// (empty here) rather than the widget slice — so `wrote` is what says it ran at all.
	it('carries the reading gate: a cut still writes, and commits nothing', async () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4, { readOnly: true });
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'cut' } as never);
		await tick();
		expect(event.wrote()).toBe(true);
		expect(commits).toEqual([]);
	});
});

// A fold whose commit changes the block's kind takes the structural path, whose completion is a
// promise; both clipboard mutations must hold or they splice bytes the fold is still replacing.
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
		edgeAffinity: { reset: () => {}, get: () => null, note: () => {}, noteTyping: () => {} },
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
