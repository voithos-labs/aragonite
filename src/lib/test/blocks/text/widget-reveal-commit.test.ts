// @vitest-environment jsdom
// How a shown source closes, through the real `createWidgetInteraction` over a mounted math widget.
// Keys in the source write as they land, so no close writes: it catches a close that pushes an
// undo entry, and the cross-block rule moving from the blur caller into the close.
import { describe, it, expect, vi } from 'vitest';
import { createWidgetInteraction } from '#lib/components/blocks/text/widget-interaction.js';
import { MATH_INLINE } from '#packages/latex/src/latex-kind.js';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';
import { settleEditor } from '#lib/test/harness/settle.js';

installMathInline();

// "Before $x^2$ after" as TextEditableBlock renders it, math between two text nodes.
function mountMathBlock() {
	const { el, node, inlineWidgets } = mountWidgetBlock('Before $x^2$ after\n', MATH_INLINE);
	const math = inlineWidgets[0];
	const updateBlockContent = vi.fn();
	const pendingCursors: (number | null)[] = [];
	let crossBlock = false;
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				blockEdit: { updateBlockContent },
				setPendingCursor: (offset: number | null) => {
					pendingCursors.push(offset);
				},
				isCrossBlock: () => crossBlock
			}
		)
	);

	async function reveal(): Promise<void> {
		interaction.enterWidget(math, false);
		await settleEditor();
	}

	return {
		interaction,
		math,
		pendingCursors,
		writes: () => updateBlockContent.mock.calls.length,
		setCrossBlock: (v: boolean) => {
			crossBlock = v;
		},
		reveal
	};
}

describe('closing a shown source before an edit', () => {
	it('writes nothing and parks the caret where it sat', async () => {
		const block = mountMathBlock();
		await block.reveal();
		expect(block.interaction.isRevealing()).toBe(true);

		const fold = block.interaction.foldRevealBeforeMutation();

		// A write that changes nothing still pushes a snapshot, so the next Ctrl+Z would revert
		// nothing.
		expect(block.writes()).toBe(0);
		expect(block.interaction.isRevealing()).toBe(false);
		expect(fold?.caret).toBe(block.math.start);
		expect(block.pendingCursors).toEqual([block.math.start]);
	});
});

describe('handleRevealingKeydown: the keys a shown source claims', () => {
	it('leaves Enter to the block, which splits after closing', async () => {
		const block = mountMathBlock();
		await block.reveal();

		const consumed = await block.interaction.handleRevealingKeydown(
			new KeyboardEvent('keydown', { key: 'Enter' })
		);

		// Taking Enter would cost the user the split; the command path closes the source itself.
		expect(consumed).toBe(false);
		expect(block.interaction.isRevealing()).toBe(true);
	});

	it('claims Escape, which closes the source without a write', async () => {
		const block = mountMathBlock();
		await block.reveal();

		const consumed = await block.interaction.handleRevealingKeydown(
			new KeyboardEvent('keydown', { key: 'Escape' })
		);

		expect(consumed).toBe(true);
		expect(block.interaction.isRevealing()).toBe(false);
		expect(block.writes()).toBe(0);
	});
});

describe('closing: the cross-block rule lives at the blur caller', () => {
	it('keeps the source shown on blur while a selection spans blocks', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.setCrossBlock(true);

		block.interaction.commitRevealOnBlur();

		// Closing would remove the text an endpoint of the range is anchored in.
		expect(block.interaction.isRevealing()).toBe(true);
	});

	it('closes for the clipboard even mid-cross-block selection', async () => {
		const block = mountMathBlock();
		await block.reveal();
		block.setCrossBlock(true);

		const fold = block.interaction.foldRevealBeforeMutation();

		// A null return means nothing was shown, which the clipboard code checks to decide whether
		// to wait for the render.
		expect(fold).not.toBeNull();
		expect(block.interaction.isRevealing()).toBe(false);
	});
});
