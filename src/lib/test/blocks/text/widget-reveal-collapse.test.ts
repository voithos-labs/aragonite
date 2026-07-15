// @vitest-environment jsdom
//
// Reveal COLLAPSE scoping, driven through the real createWidgetInteraction over a
// mounted two-widget math DOM — sibling of widget-reveal-commit.test.ts, which
// pins the commit/undo contract. Collapse must be selection-containment-scoped,
// not blur-scoped: a caret that leaves the revealed source while staying inside
// the block folds the reveal (identity-exact, no CST commit, caret untouched),
// and a click on a second widget folds the first and reveals the second as one
// sequenced gesture instead of dying on the active-reveal guard.
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import type { CstNode, InlineNode } from '$lib/core/nodes';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { stampMathWidget, resetInlineState } from './math-widget-fixture';

beforeEach(() => {
	resetInlineState();
	registerMathInline();
});

afterEach(() => {
	document.body.innerHTML = '';
	resetInlineState();
});

// "One $a^1$ two $b^2$ end" as TextEditableBlock renders it: two atomic islands
// between three real text nodes. Children: [prose, widgetA, prose, widgetB, prose].
function mountTwoMathBlock() {
	const node: CstNode = parse('One $a^1$ two $b^2$ end').children[0];
	const [first, second] = computeInlineContent(node).filter(
		(n: InlineNode) => n.kind === MATH_INLINE
	);
	const firstWidget = stampMathWidget(first);
	const secondWidget = stampMathWidget(second);
	// jsdom lays out nothing: hand the second widget a real box so the click
	// hit-test in snapClickToWidgetEdge can land inside it.
	secondWidget.getBoundingClientRect = () =>
		({ left: 100, right: 120, top: 0, bottom: 10, width: 20, height: 10, x: 100, y: 0 }) as DOMRect;

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(
		document.createTextNode(node.raw.slice(0, first.start)),
		firstWidget,
		document.createTextNode(node.raw.slice(first.end, second.start)),
		secondWidget,
		document.createTextNode(node.raw.slice(second.end).replace(/\n$/, ''))
	);
	document.body.appendChild(el);
	el.focus();

	const commits: unknown[] = [];
	const pendingCursors: (number | null)[] = [];
	let crossBlock = false;
	let pendingClickPoint: { x: number; y: number } | null = null;
	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });

	const trap = () => {
		throw new Error('unexpected dep access on the reveal-collapse path');
	};
	const interaction = createWidgetInteraction({
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => 800,
		cursor: new Proxy({}, { get: trap }),
		widgetSelection,
		blockEdit: {
			updateBlockContent: (...args: unknown[]) => {
				commits.push(args);
			}
		},
		focusActions: new Proxy({}, { get: trap }),
		getSnapTarget: () => null,
		setSnapTarget: () => {},
		setPendingCursor: (offset: number | null) => {
			pendingCursors.push(offset);
		},
		readRawText: () =>
			Array.from(el.childNodes).reduce((acc, child) => acc + rawTextOfNode(child, node.raw), ''),
		setRevealing: () => {},
		isCrossBlock: () => crossBlock,
		getPendingClickPoint: () => pendingClickPoint,
		get linkRef() {
			return undefined;
		}
	} as unknown as WidgetInteractionDeps);

	// Arrow-entry from the right of the first widget opens its reveal at the trailing
	// edge (the Obsidian model — no select-then-Enter). handleWidgetAtCursorKeydown
	// runs startReveal's synchronous prefix (showSource + revealSettling) before it
	// returns, so the reveal is already swapping when the caller inspects it.
	async function revealFirst(): Promise<void> {
		interaction.handleWidgetAtCursorKeydown(
			new KeyboardEvent('keydown', { key: 'ArrowLeft' }),
			asRawOffset(first.end)
		);
		await new Promise((r) => setTimeout(r));
	}

	function placeCaretIn(target: Node, offset: number): void {
		const range = document.createRange();
		range.setStart(target, offset);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	return {
		el,
		interaction,
		commits,
		pendingCursors,
		firstWidget,
		secondWidget,
		revealFirst,
		placeCaretIn,
		sourceNode: () => el.childNodes[1] as Text,
		trailingText: () => el.childNodes[4] as Text,
		setCrossBlock: (v: boolean) => {
			crossBlock = v;
		},
		setPendingClickPoint: (p: { x: number; y: number } | null) => {
			pendingClickPoint = p;
		}
	};
}

describe('foldRevealIfSelectionEscaped — containment scope', () => {
	it('folds identity-exact, without a CST commit, when the caret leaves the source in-block', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		expect(b.interaction.isRevealing()).toBe(true);

		b.placeCaretIn(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.commits).toEqual([]);
		// Identity, not equivalence: the very element the reveal detached returns to
		// its slot. Boolean form deliberately — a failing `.toBe(domNode)` diff
		// serializes the node into `window` and trips Svelte's dev-time `$state`
		// trap, masking the failure.
		expect(b.el.childNodes[1] === b.firstWidget).toBe(true);
	});

	it('leaves the escaped caret alone — no pending-cursor override', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.pendingCursors.length = 0;

		b.placeCaretIn(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.pendingCursors).toEqual([]);
		const sel = window.getSelection()!;
		expect(sel.anchorNode === b.trailingText()).toBe(true);
		expect(sel.anchorOffset).toBe(2);
	});

	it('keeps the reveal while the selection stays inside the source', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();

		b.placeCaretIn(b.sourceNode(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(true);
	});

	it('keeps the reveal while a selection spans blocks (cross-block bail)', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.setCrossBlock(true);

		b.placeCaretIn(b.trailingText(), 1);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.commits).toEqual([]);
	});

	it('switches to the second widget through the click dispatch as one gesture', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		expect(b.interaction.isRevealing()).toBe(true);

		// Click on widget B while A is revealed: the owned click path folds A
		// (in-place, no CST commit — clean reveal) and reveals B. Pointerdown
		// preventDefault means no selectionchange competes with this sequence.
		b.interaction.snapClickToWidgetEdge(110, 5);
		await new Promise((r) => setTimeout(r));
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.commits).toEqual([]);
		// A's widget element is back in the DOM (identity restore); B's is swapped
		// out for its source text node.
		expect(b.el.querySelectorAll('[data-inline-widget]').length).toBe(1);
	});

	it('holds a reveal still settling — the fold window between showSource and placeCaret', async () => {
		const b = mountTwoMathBlock();
		// The click's own queued selectionchange lands after showSource has swapped
		// but before placeCaret moves the caret into the source: the selection still
		// sits in prose, so an unguarded containment check folds the opening reveal.
		b.placeCaretIn(b.trailingText(), 2);
		const settling = b.revealFirst(); // NOT awaited: parked at the pre-placeCaret tick

		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));
		await settling;

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.el.childNodes[1].nodeType).toBe(Node.TEXT_NODE);
		expect(b.el.childNodes[1].textContent).toBe('$a^1$');

		// Settled: the same escape folds normally again.
		b.placeCaretIn(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('reveal switch — clicking widget B while A is revealed', () => {
	it('folds A and reveals B in one sequenced gesture', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();

		await b.interaction.snapClickToWidgetEdge(110, 5);

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.commits).toEqual([]);
		expect(b.el.childNodes[1] === b.firstWidget).toBe(true);
		expect(b.el.childNodes[3].nodeType).toBe(Node.TEXT_NODE);
		expect(b.el.childNodes[3].textContent).toBe('$b^2$');
	});
});
