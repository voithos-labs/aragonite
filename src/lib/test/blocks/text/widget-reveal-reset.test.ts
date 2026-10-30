// @vitest-environment jsdom
// Every way out of a shown source closes the same range and writes nothing, so all of them leave
// the same idle state and it can be used again afterwards. Anything an exit leaves behind, a
// `settling` flag stuck true or a stale range, shows up as a broken second cycle.
import { describe, it, expect, vi } from 'vitest';
import { createWidgetInteraction } from '#lib/components/blocks/text/widget-interaction.js';
import { MATH_INLINE } from '#packages/latex/src/latex-kind.js';
import {
	installMathInline,
	mountWidgetBlock,
	placeCaretAt,
	widgetInteractionDeps
} from './math-widget-fixture';
import { settleEditor } from '#lib/test/harness/settle.js';

installMathInline();
const key = (k: string) => new KeyboardEvent('keydown', { key: k });

// "Before $x^2$ after" as TextEditableBlock renders it: one atomic widget between
// two real text nodes. childNodes = [prose, widget|source, trailing prose].
function mountMathBlock() {
	const { el, node, inlineWidgets } = mountWidgetBlock('Before $x^2$ after', MATH_INLINE);
	const math = inlineWidgets[0];

	const updateBlockContent = vi.fn();
	const deps = widgetInteractionDeps(
		{ node, el },
		{
			blockEdit: { updateBlockContent },
			setPendingCursor: () => {},
			isCrossBlock: () => false
		}
	);
	const interaction = createWidgetInteraction(deps);

	async function reveal(): Promise<void> {
		interaction.enterWidget(math, false);
		await settleEditor();
	}
	return {
		interaction,
		el,
		reveal,
		shownRange: () => deps.shownSource.rangeIn([0], node),
		writes: () => updateBlockContent.mock.calls.length,
		sourceNode: () => el.childNodes[1] as Text,
		trailingText: () => el.childNodes[2] as Text
	};
}

type Block = ReturnType<typeof mountMathBlock>;

describe('canonical reset: every exit lands in the same idle state', () => {
	const exits: [string, (b: Block) => Promise<void>][] = [
		['fold-commit', async (b) => void b.interaction.foldRevealBeforeMutation()],
		[
			'Escape-cancel',
			async (b) => void (await b.interaction.handleRevealingKeydown(key('Escape')))
		],
		['blur-commit', async (b) => b.interaction.commitRevealOnBlur()],
		[
			'selection-escape',
			async (b) => {
				placeCaretAt(b.trailingText(), 2);
				b.interaction.foldRevealIfSelectionEscaped();
				await settleEditor();
			}
		]
	];

	for (const [label, exit] of exits) {
		it(`${label} clears isRevealing and closes the range without a write`, async () => {
			const b = mountMathBlock();
			await b.reveal();
			expect(b.interaction.isRevealing()).toBe(true);
			expect(b.shownRange()).toEqual({ start: 7, end: 12 });

			await exit(b);

			expect(b.interaction.isRevealing()).toBe(false);
			expect(b.shownRange()).toBeNull();
			expect(b.writes()).toBe(0);
		});
	}
});

describe('canonical reset: the machine is reusable after a fold', () => {
	it('a fresh reveal → escape-fold cycle still works after Escape-cancel', async () => {
		const b = mountMathBlock();
		await b.reveal();
		await b.interaction.handleRevealingKeydown(key('Escape'));
		expect(b.interaction.isRevealing()).toBe(false);
		// The widget is restored in place, so it can be swapped again.
		expect(b.el.childNodes[1].nodeType).toBe(Node.ELEMENT_NODE);

		await b.reveal();
		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.sourceNode().nodeType).toBe(Node.TEXT_NODE);
		expect(b.sourceNode().textContent).toBe('$x^2$');

		// The second exit must still hide the source: a `settling` flag left true by a
		// reset that went another way would disable it for good.
		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await settleEditor();
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('canonical reset: Escape closes before it awaits the render', () => {
	it('reads idle synchronously the instant Escape returns', async () => {
		const b = mountMathBlock();
		await b.reveal();
		expect(b.interaction.isRevealing()).toBe(true);

		// The range closes before the awaited render, which keeps the render's selectionchange out
		// of the exit check. Observed without awaiting.
		const pending = b.interaction.handleRevealingKeydown(key('Escape'));
		expect(b.interaction.isRevealing()).toBe(false);
		await pending;
	});
});
