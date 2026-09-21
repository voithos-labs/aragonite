// @vitest-environment jsdom
//
// Every way out of a shown source goes through the one resetReveal, so all of them leave the same
// idle state and it can be used again afterwards. Anything an exit leaves behind, a `settling`
// flag stuck true or a stale record, shows up as a broken second cycle.
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

const settle = () => new Promise((r) => setTimeout(r));
const key = (k: string) => new KeyboardEvent('keydown', { key: k });

// "Before $x^2$ after" as TextEditableBlock renders it: one atomic widget between
// two real text nodes. childNodes = [prose, widget|source, trailing prose].
function mountMathBlock() {
	const { el, node, inlineWidgets } = mountWidgetBlock('Before $x^2$ after', MATH_INLINE);
	const math = inlineWidgets[0];

	let revealingMirror = false;
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				blockEdit: { updateBlockContent: () => {} },
				setPendingCursor: () => {},
				setRevealing: (v: boolean) => {
					revealingMirror = v;
				},
				isCrossBlock: () => false
			}
		)
	);

	async function reveal(): Promise<void> {
		interaction.enterWidget(math, false);
		await settle();
	}
	return {
		interaction,
		el,
		reveal,
		revealingMirror: () => revealingMirror,
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
				await settle();
			}
		]
	];

	for (const [label, exit] of exits) {
		it(`${label} clears isRevealing and lifts the input-suppress mirror`, async () => {
			const b = mountMathBlock();
			await b.reveal();
			expect(b.interaction.isRevealing()).toBe(true);
			expect(b.revealingMirror()).toBe(true);

			await exit(b);

			expect(b.interaction.isRevealing()).toBe(false);
			expect(b.revealingMirror()).toBe(false);
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
		await settle();
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('canonical reset: cancel nulls the record before awaiting the shared core restore', () => {
	it('reads idle synchronously the instant Escape-cancel returns', async () => {
		const b = mountMathBlock();
		await b.reveal();
		expect(b.interaction.isRevealing()).toBe(true);

		// resetReveal() runs synchronously before the awaited commit, which keeps showRendered's
		// selectionchange out of the exit check mid-swap. Observed without awaiting.
		const pending = b.interaction.handleRevealingKeydown(key('Escape'));
		expect(b.interaction.isRevealing()).toBe(false);
		await pending;
	});
});
