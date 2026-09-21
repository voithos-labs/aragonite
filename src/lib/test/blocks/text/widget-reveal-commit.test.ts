// @vitest-environment jsdom
//
// `commitReveal`'s undo and caret rules, driven through the real createWidgetInteraction over a
// mounted math-widget DOM: above the primitive (cursor/reveal-source.test.ts) and below the e2e
// undo stack (plugins/latex-inline.spec.ts). Three failures it catches: a commit that changes
// nothing pushing a useless undo entry, a caret taken from the widget's stale end after a commit,
// and the cross-block rule moving out of the blur caller into the commit itself.
import { describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';
import type { Commit } from './widget-selected-fixture';

installMathInline();

// A paragraph "Before $x^2$ after" mounted as TextEditableBlock renders it: the
// math is one atomic [data-inline-widget] element between two real text nodes.
function mountMathBlock() {
	const { el, node, inlineWidgets } = mountWidgetBlock('Before $x^2$ after', MATH_INLINE);
	const math = inlineWidgets[0];

	const commits: Commit[] = [];
	const pendingCursors: { offset: number | null; writtenText?: string }[] = [];
	let crossBlock = false;

	const trap = () => {
		throw new Error('unexpected dep access on the reveal-commit path');
	};
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				cursor: new Proxy({}, { get: trap }),
				blockEdit: {
					updateBlockContent: (index: number, raw: string, before: number, after: number) => {
						commits.push({ index, raw, before, after });
					}
				},
				focusActions: new Proxy({}, { get: trap }),
				setPendingCursor: (offset: number | null, writtenText?: string) => {
					pendingCursors.push({ offset, writtenText });
				},
				setRevealing: () => {},
				isCrossBlock: () => crossBlock
			}
		)
	);

	// Entry from the leading edge anchors undo at the widget's leading offset (math.start), the
	// anchor the commit assertions below depend on; the trailing edge would anchor at math.end.
	async function reveal(): Promise<void> {
		interaction.enterWidget(math, false);
		await new Promise((r) => setTimeout(r));
	}

	return {
		interaction,
		commits,
		pendingCursors,
		math,
		sourceNode: () => el.childNodes[1] as Text,
		trailingTextNode: () => el.childNodes[2] as Text,
		setCrossBlock: (v: boolean) => {
			crossBlock = v;
		},
		reveal
	};
}

// The one call every commit gesture goes through. Driving it directly keeps these cases about
// the commit rules rather than about whichever key happens to reach it.
function commitViaFold(interaction: ReturnType<typeof mountMathBlock>['interaction']) {
	interaction.foldRevealBeforeMutation();
}

describe('commitReveal: no-edit short-circuit', () => {
	it('folds back without a CST commit when the source is unchanged', async () => {
		const block = mountMathBlock();
		await block.reveal();
		expect(block.interaction.isRevealing()).toBe(true);

		commitViaFold(block.interaction);

		// A call to `updateBlockContent` that changes nothing still pushes a snapshot,
		// so the user's next Ctrl+Z reverts nothing.
		expect(block.commits).toEqual([]);
		expect(block.interaction.isRevealing()).toBe(false);
		// Hidden again through the focus-checked pending cursor, landing at the widget's trailing
		// edge. No text comes with it: nothing was written, so the offset already fits the CST.
		expect(block.pendingCursors).toEqual([{ offset: block.math.end, writtenText: undefined }]);
	});
});

describe('handleRevealingKeydown: the keys a reveal claims', () => {
	it('leaves Enter to the block, which splits after folding', async () => {
		const block = mountMathBlock();
		await block.reveal();

		const consumed = await block.interaction.handleRevealingKeydown(
			new KeyboardEvent('keydown', { key: 'Enter' })
		);

		// Declining is the whole rule: taking Enter would cost the user the split, and
		// nothing here may hide the source on its own, since the command path sets that order.
		expect(consumed).toBe(false);
		expect(block.interaction.isRevealing()).toBe(true);
		expect(block.commits).toEqual([]);
	});

	it('still claims Escape', async () => {
		const block = mountMathBlock();
		await block.reveal();

		const consumed = await block.interaction.handleRevealingKeydown(
			new KeyboardEvent('keydown', { key: 'Escape' })
		);

		expect(consumed).toBe(true);
		expect(block.interaction.isRevealing()).toBe(false);
	});
});

describe('commitReveal: edit persistence and caret precision', () => {
	it('commits an in-source edit once, caret at the widget trailing edge', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.sourceNode().textContent = '$yx^2$';

		commitViaFold(block.interaction);

		expect(block.commits).toHaveLength(1);
		expect(block.commits[0]).toMatchObject({
			index: 0,
			raw: 'Before $yx^2$ after\n',
			before: block.math.start,
			after: block.math.end + 1
		});
	});

	it('derives the caret from the widget position, not a whole-block length delta', async () => {
		const block = mountMathBlock();
		await block.reveal();
		// Edit the prose after the widget: the widget's trailing edge is unmoved, so a
		// `widgetEnd + totalDelta` caret would land one character too far.
		block.trailingTextNode().textContent = ' afterZ';

		commitViaFold(block.interaction);

		expect(block.commits).toHaveLength(1);
		expect(block.commits[0].raw).toBe('Before $x^2$ afterZ\n');
		expect(block.commits[0].after).toBe(block.math.end);
	});

	it('puts the caret together with the text that caret addresses', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.sourceNode().textContent = '$yx^2$';

		commitViaFold(block.interaction);

		// The pending cursor skips the write path a rewriting kind needs, so it can only be mapped
		// against the text it counts into, which therefore has to travel with it.
		expect(block.pendingCursors).toEqual([
			{ offset: block.math.end + 1, writtenText: 'Before $yx^2$ after' }
		]);
	});
});

describe('commitReveal: the cross-block rule lives at the blur caller', () => {
	it('keeps the source revealed on blur while a selection spans blocks', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.setCrossBlock(true);

		block.interaction.commitRevealOnBlur();

		// Refused: no commit, and the source still shows, so hiding it cannot remove the
		// text node an endpoint is anchored in.
		expect(block.commits).toEqual([]);
		expect(block.interaction.isRevealing()).toBe(true);
	});

	it('folds an edited source for the clipboard even mid-cross-block selection', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.sourceNode().textContent = '$yx^2$';
		block.setCrossBlock(true);

		const caret = block.interaction.foldRevealBeforeMutation();

		// A null return means nothing was shown, which the clipboard code checks to decide whether
		// to wait. Refusing here would let cut and paste splice the old bytes with no undo entry.
		expect(caret).not.toBeNull();
		expect(block.commits).toHaveLength(1);
		expect(block.commits[0].raw).toBe('Before $yx^2$ after\n');
		expect(block.interaction.isRevealing()).toBe(false);
	});
});

describe('cancelReveal: identity-exact fold-back', () => {
	// Two byte-identical widgets: cancelling must put back the exact element it detached.
	// Rebuilding by lookup (the pool keys on `${kind} ${source}`) would move the other instance.
	it('Escape restores the same element it swapped out, leaving its counterpart untouched', async () => {
		const { el, node, widgets, inlineWidgets } = mountWidgetBlock(
			'Twice $x^2$ and $x^2$ again',
			MATH_INLINE
		);
		const [firstWidget, secondWidget] = widgets;
		const second = inlineWidgets[1];

		const interaction = createWidgetInteraction(
			widgetInteractionDeps(
				{ node, el },
				{
					setPendingCursor: () => {},
					setRevealing: () => {},
					isCrossBlock: () => false
				}
			)
		);

		interaction.enterWidget(second, false);
		await new Promise((r) => setTimeout(r));
		expect(el.childNodes[3]).not.toBe(secondWidget); // swapped for the source text node
		await interaction.handleRevealingKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

		// The same element, not an equal one: the detached element itself returns, in place.
		expect(el.childNodes[1]).toBe(firstWidget);
		expect(el.childNodes[3]).toBe(secondWidget);
		expect((el.childNodes[3] as HTMLElement).dataset.sourceStart).toBe(String(second.start));
	});
});
