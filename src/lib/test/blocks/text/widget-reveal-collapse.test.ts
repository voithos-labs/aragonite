// @vitest-environment jsdom
//
// When a shown source is hidden again, driven through the real createWidgetInteraction over a
// mounted DOM with two math widgets; the sibling of widget-reveal-commit.test.ts, which covers
// the commit and undo rules. What matters is where the selection is, not whether the block has
// focus: a caret leaving the shown source while staying in the block hides it, and a click on a
// second widget hides the first and shows the second as one sequence.
import { describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import {
	installMathInline,
	mountWidgetBlock,
	placeCaretAt,
	widgetInteractionDeps
} from './math-widget-fixture';
import { settleEditor } from '$lib/test/harness/settle';

installMathInline();

// "One $a^1$ two $b^2$ end" as TextEditableBlock renders it: two atomic widgets
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

	// Entering from the trailing edge shows the source at that edge, as Obsidian does, with no
	// select-then-Enter; `enterWidget` runs the synchronous part of `startReveal` before it returns.
	async function revealFirst(): Promise<void> {
		interaction.enterWidget(first, true);
		await settleEditor();
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

describe('foldRevealIfSelectionEscaped: containment scope', () => {
	it('folds identity-exact, without a CST commit, when the caret leaves the source in-block', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		expect(b.interaction.isRevealing()).toBe(true);

		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();

		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.commits).toEqual([]);
		// The same element, not an equal one: the very element that was detached returns to its
		// place. Written as a boolean on purpose, since a `.toBe(domNode)` diff would trip
		// Svelte's `$state` proxy and hide it.
		expect(b.el.childNodes[1] === b.firstWidget).toBe(true);
	});

	it('leaves the escaped caret alone: no pending-cursor override', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.pendingCursors.length = 0;

		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();

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
		await settleEditor();

		expect(b.interaction.isRevealing()).toBe(true);
	});

	it('keeps the reveal while a selection spans blocks (cross-block bail)', async () => {
		const b = mountTwoMathBlock();
		await b.revealFirst();
		b.setCrossBlock(true);

		placeCaretAt(b.trailingText(), 1);
		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.commits).toEqual([]);
	});

	it('holds a reveal still settling: the fold window between showSource and placeCaret', async () => {
		const b = mountTwoMathBlock();
		// The click's own queued selectionchange lands after showSource swapped but before
		// placeCaret moves into the source, so an unchecked containment test would hide it again.
		placeCaretAt(b.trailingText(), 2);
		const settling = b.revealFirst(); // not awaited: left at the tick before placeCaret

		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();
		await settling;

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.el.childNodes[1].nodeType).toBe(Node.TEXT_NODE);
		expect(b.el.childNodes[1].textContent).toBe('$a^1$');

		// Once settled, the same exit hides the source normally again.
		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('reveal switch, clicking widget B while A is revealed', () => {
	// The editor's own click handling hides A in place and shows B as one sequence,
	// rather than stopping because one is already shown; no selectionchange competes.
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
