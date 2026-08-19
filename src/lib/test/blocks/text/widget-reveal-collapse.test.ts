// @vitest-environment jsdom
//
// Reveal COLLAPSE scoping, driven through the real createWidgetInteraction over a mounted
// two-widget math DOM — sibling of widget-reveal-commit.test.ts, which pins the commit/undo
// contract. Collapse is selection-containment-scoped, not blur-scoped: a caret leaving the
// revealed source while staying inside the block folds it, and a click on a second widget folds
// the first and reveals the second as one sequenced gesture instead of dying on the active guard.
import { describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import {
	installMathInline,
	mountWidgetBlock,
	placeCaretAt,
	widgetInteractionDeps
} from './math-widget-fixture';

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

	// Entry from the trailing edge opens the reveal at that edge (the Obsidian model, no
	// select-then-Enter); enterWidget runs startReveal's synchronous prefix before it returns.
	async function revealFirst(): Promise<void> {
		interaction.enterWidget(first, true);
		await new Promise((r) => setTimeout(r));
	}

	return {
		el,
		interaction,
		commits,
		pendingCursors,
		firstWidget,
		secondWidget,
		revealFirst,
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

		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.commits).toEqual([]);
		// Identity, not equivalence: the very element the reveal detached returns to its slot. Boolean
		// form deliberately: a `.toBe(domNode)` diff would trip Svelte's `$state` trap and mask it.
		expect(b.el.childNodes[1] === b.firstWidget).toBe(true);
	});

	it('leaves the escaped caret alone — no pending-cursor override', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.pendingCursors.length = 0;

		placeCaretAt(b.trailingText(), 2);
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

		placeCaretAt(b.sourceNode(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(true);
	});

	it('keeps the reveal while a selection spans blocks (cross-block bail)', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.setCrossBlock(true);

		placeCaretAt(b.trailingText(), 1);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.commits).toEqual([]);
	});

	it('holds a reveal still settling — the fold window between showSource and placeCaret', async () => {
		const b = mountTwoMathBlock();
		// The click's own queued selectionchange lands after showSource swapped but before placeCaret
		// moves into the source, so an unguarded containment check folds the opening reveal.
		placeCaretAt(b.trailingText(), 2);
		const settling = b.revealFirst(); // NOT awaited: parked at the pre-placeCaret tick

		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));
		await settling;

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.el.childNodes[1].nodeType).toBe(Node.TEXT_NODE);
		expect(b.el.childNodes[1].textContent).toBe('$a^1$');

		// Settled: the same escape folds normally again.
		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await new Promise((r) => setTimeout(r));
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('reveal switch — clicking widget B while A is revealed', () => {
	// The owned click dispatch folds A in place and reveals B as one sequence,
	// instead of dying on the active guard; no selectionchange competes with it.
	it('folds A and reveals B in one sequenced gesture through the click dispatch', async () => {
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
