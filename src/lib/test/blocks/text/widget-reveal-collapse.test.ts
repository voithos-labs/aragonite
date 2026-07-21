// @vitest-environment jsdom
//
// Reveal COLLAPSE scoping, driven through the real createWidgetInteraction over a
// mounted two-widget math DOM — sibling of widget-reveal-commit.test.ts, which
// pins the commit/undo contract. Collapse must be selection-containment-scoped,
// not blur-scoped: a caret that leaves the revealed source while staying inside
// the block folds the reveal (identity-exact, no CST commit, caret untouched),
// and a click on a second widget folds the first and reveals the second as one
// sequenced gesture instead of dying on the active-reveal guard.
import { describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';

installMathInline();

// "One $a^1$ two $b^2$ end" as TextEditableBlock renders it: two atomic islands
// between three real text nodes. Children: [prose, widgetA, prose, widgetB, prose].
function mountTwoMathBlock() {
	const { el, node, widgets, inlineWidgets } = mountWidgetBlock(
		'One $a^1$ two $b^2$ end',
		MATH_INLINE
	);
	const [firstWidget, secondWidget] = widgets;
	const [first] = inlineWidgets;
	// jsdom lays out nothing: hand the second widget a real box so the click
	// hit-test in snapClickToWidgetEdge can land inside it.
	secondWidget.getBoundingClientRect = () =>
		({ left: 100, right: 120, top: 0, bottom: 10, width: 20, height: 10, x: 100, y: 0 }) as DOMRect;

	const commits: unknown[] = [];
	const pendingCursors: (number | null)[] = [];
	let crossBlock = false;
	let pendingClickPoint: { x: number; y: number } | null = null;

	const trap = () => {
		throw new Error('unexpected dep access on the reveal-collapse path');
	};
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				cursor: new Proxy({}, { get: trap }),
				blockEdit: {
					updateBlockContent: (...args: unknown[]) => {
						commits.push(args);
					}
				},
				focusActions: new Proxy({}, { get: trap }),
				setPendingCursor: (offset: number | null) => {
					pendingCursors.push(offset);
				},
				setRevealing: () => {},
				isCrossBlock: () => crossBlock,
				getPendingClickPoint: () => pendingClickPoint
			}
		)
	);

	// Entry from the trailing edge opens the first widget's reveal at that edge (the
	// Obsidian model — no select-then-Enter). enterWidget runs startReveal's
	// synchronous prefix (showSource + revealSettling) before it returns, so the
	// reveal is already swapping when the caller inspects it.
	async function revealFirst(): Promise<void> {
		interaction.enterWidget(first, true);
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
