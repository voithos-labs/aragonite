// @vitest-environment jsdom
//
// The copy and cut branches for a selected widget in createTextClipboard: a selected inline
// widget (an image, a `<br>`) copies its own raw slice through `e.clipboardData.setData`, and
// cut also splices that slice out as one undoable commit. A real parse resolved through
// `getInlineContent`, a captured ClipboardEvent stand-in, and the real widget-selection state,
// with no branch on `kind === 'image'`.
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
import { fixtureReading } from '../../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { stubCaretMemory } from '$lib/testing/headless-actions';

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
	/** Leaving the selection out stands in for a widget selected on another block. */
	selectWidget?: boolean;
	readOnly?: boolean;
	/** Paste asks the cross-block handler before the widget branch; every other path leaves
	 *  the trap in place, which is what proves it never fell through. */
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
		caretMemory: stubCaretMemory(),
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
		grammar: defaultGrammarView,
		get reading() {
			return fixtureReading();
		}
	} as unknown as TextClipboardDeps;

	return { handlers: createTextClipboard(deps), commits, widgetSelection };
}

describe('createTextClipboard: selected-widget copy', () => {
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

describe('createTextClipboard: selected-widget cut', () => {
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

// What the editor root hands back: the browser dispatches at `<body>` when the paragraph holds
// no text position. Forwarding to the same handlers a caret-side event reaches is what brings
// the reading-mode check and the sticky-column reset along with it.
describe('createTextClipboard: claimRootClipboard', () => {
	it('routes each clipboard type to the branch the caret route reaches', async () => {
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

	// The trap dependencies prove it: the check must not reach a handler, or the block would
	// answer for a widget selected somewhere else.
	it('stays inert when the selected widget is not this block’s', () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4, { selectWidget: false });
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'copy' } as never);
		expect(event.wrote()).toBe(false);
		expect(commits).toEqual([]);
	});

	it('stays inert for an event type no branch owns', () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4);
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'beforeinput' } as never);
		expect(event.wrote()).toBe(false);
		expect(commits).toEqual([]);
	});

	// Reading mode turns the cut into a copy, which writes the visible selection (empty here)
	// rather than the widget slice, so `wrote` is what says it ran at all.
	it('carries the reading gate: a cut still writes, and commits nothing', async () => {
		const { handlers, commits } = harness('lead![cat](x)\n', 4, { readOnly: true });
		const event = capturingEvent();
		handlers.claimRootClipboard({ ...event, type: 'cut' } as never);
		await tick();
		expect(event.wrote()).toBe(true);
		expect(commits).toEqual([]);
	});
});

// Hiding a source whose commit changes the block's kind takes the structural path, whose
// completion is a promise; cut and paste must both wait, or they splice bytes still being
// replaced.
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
		caretMemory: stubCaretMemory(),
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
		grammar: defaultGrammarView,
		get reading() {
			return fixtureReading();
		}
	} as unknown as TextClipboardDeps;

	return { handlers: createTextClipboard(deps), order, releaseWrite };
}

describe('createTextClipboard: a mutation waits for the reveal fold it triggered', () => {
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
