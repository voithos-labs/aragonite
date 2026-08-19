// @vitest-environment jsdom
//
// Canonical reset: every reveal exit path funnels through the one resetReveal, so all of them
// land in the same observable idle state and the machine is reusable afterward. Anything an exit
// path leaves behind (a wedged `settling` flag, a stale record) shows up as a broken second cycle.
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

// "Before $x^2$ after" as TextEditableBlock renders it: one atomic island between
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

describe('canonical reset — every exit lands in the same idle state', () => {
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

describe('canonical reset — the machine is reusable after a fold', () => {
	it('a fresh reveal → escape-fold cycle still works after Escape-cancel', async () => {
		const b = mountMathBlock();
		await b.reveal();
		await b.interaction.handleRevealingKeydown(key('Escape'));
		expect(b.interaction.isRevealing()).toBe(false);
		// Widget restored in place, so a fresh reveal can swap it again.
		expect(b.el.childNodes[1].nodeType).toBe(Node.ELEMENT_NODE);

		await b.reveal();
		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.sourceNode().nodeType).toBe(Node.TEXT_NODE);
		expect(b.sourceNode().textContent).toBe('$x^2$');

		// The second escape-fold must still fire: a `settling` residual left true by a
		// non-canonical reset would permanently disable it.
		placeCaretAt(b.trailingText(), 2);
		b.interaction.foldRevealIfSelectionEscaped();
		await settle();
		expect(b.interaction.isRevealing()).toBe(false);
	});
});

describe('canonical reset — cancel nulls the record before awaiting the kernel restore', () => {
	it('reads idle synchronously the instant Escape-cancel returns', async () => {
		const b = mountMathBlock();
		await b.reveal();
		expect(b.interaction.isRevealing()).toBe(true);

		// resetReveal() runs synchronously ahead of `await kernel.commit()`, which is what keeps
		// showRendered's selectionchange out of the escape-fold mid-swap. Observed WITHOUT awaiting.
		const pending = b.interaction.handleRevealingKeydown(key('Escape'));
		expect(b.interaction.isRevealing()).toBe(false);
		await pending;
	});
});
