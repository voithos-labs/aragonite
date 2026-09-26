import { describe, it, expect, vi } from 'vitest';
import { consumeStickyLanding } from '$lib/editor-actions/focus/focus-landing';
import { CURSOR_END, CURSOR_START } from '$lib/block-component';
import { asEditorX } from '$lib/cursor/coordinate-spaces';
import { createCaretMemory, type CaretMemory } from '$lib/cursor/caret-memory';
import { stubBlockComponent } from '$lib/test/harness/editor-actions';

function capturedSticky(x: number): CaretMemory {
	const memory = createCaretMemory();
	memory.captureColumn(asEditorX(x));
	return memory;
}

describe('consumeStickyLanding', () => {
	it('sticky move from above skips a vertically-transparent block downward', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(
			block,
			3,
			{ stickyColumnFrom: 'above' },
			createCaretMemory(),
			retryAt
		);
		expect(retryAt).toHaveBeenCalledWith(4);
		expect(block.focus).not.toHaveBeenCalled();
	});

	// Miss-analysis (#326): the same rule lived in the container's column entry too, and no test
	// read the two together, so a block was a stop on one path and passed over on the other.
	it.each([
		['above', 'start'],
		['below', 'end']
	] as const)(
		'sticky move from %s stops on a transparent block, at its %s edge',
		async (from, side) => {
			const image = stubBlockComponent({
				focus: vi.fn(),
				isVerticallyTransparent: () => true,
				enterEdgeWidget: vi.fn(() => true)
			});
			const retryAt = vi.fn();
			await consumeStickyLanding(
				image,
				3,
				{ stickyColumnFrom: from },
				createCaretMemory(),
				retryAt
			);
			expect(image.enterEdgeWidget).toHaveBeenCalledWith(side);
			expect(retryAt).not.toHaveBeenCalled();
			expect(image.focus).not.toHaveBeenCalled();
		}
	);

	it('sticky move from below skips a vertically-transparent block upward', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(
			block,
			3,
			{ stickyColumnFrom: 'below' },
			createCaretMemory(),
			retryAt
		);
		expect(retryAt).toHaveBeenCalledWith(2);
	});

	it('horizontal move lands on a transparent block instead of skipping', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(block, 0, 'start', createCaretMemory(), retryAt);
		expect(retryAt).not.toHaveBeenCalled();
		expect(block.focus).toHaveBeenCalledWith(CURSOR_START);
	});

	for (const side of ['start', 'end'] as const) {
		it(`'${side}' prefers edge-widget entry when the block accepts`, async () => {
			const block = stubBlockComponent({ focus: vi.fn(), enterEdgeWidget: vi.fn(() => true) });
			await consumeStickyLanding(block, 0, side, createCaretMemory(), vi.fn());
			expect(block.enterEdgeWidget).toHaveBeenCalledWith(side);
			expect(block.focus).not.toHaveBeenCalled();
		});
	}

	it('falls through to the caret when enterEdgeWidget declines', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), enterEdgeWidget: vi.fn(() => false) });
		await consumeStickyLanding(block, 0, 'end', createCaretMemory(), vi.fn());
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky move with captured x routes through focusAtColumn', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'above' },
			capturedSticky(42),
			vi.fn()
		);
		expect(block.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(block.focus).not.toHaveBeenCalled();
	});

	it('sticky move with no captured x falls back to focus(CURSOR_START) from above', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'above' },
			createCaretMemory(),
			vi.fn()
		);
		expect(block.focusAtColumn).not.toHaveBeenCalled();
		expect(block.focus).toHaveBeenCalledWith(CURSOR_START);
	});

	it('sticky move with no captured x falls back to focus(CURSOR_END) from below', async () => {
		const block = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'below' },
			createCaretMemory(),
			vi.fn()
		);
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky move with captured x but no focusAtColumn falls back by direction', async () => {
		const block = stubBlockComponent({ focus: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'below' },
			capturedSticky(42),
			vi.fn()
		);
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	// A numeric position is a caller that knows its byte and passes through; 'start' and 'end'
	// are arrivals, each passed as its sentinel so the block's focus may clamp it onto an offset
	// the caret can sit at.
	it('lands numeric positions literally and the edges through their sentinels', async () => {
		const cases: Array<{ position: number | 'start' | 'end'; offset: number }> = [
			{ position: 7, offset: 7 },
			{ position: 'start', offset: CURSOR_START },
			{ position: 'end', offset: CURSOR_END }
		];
		for (const { position, offset } of cases) {
			const block = stubBlockComponent({ focus: vi.fn() });
			await consumeStickyLanding(block, 0, position, createCaretMemory(), vi.fn());
			expect(block.focus).toHaveBeenCalledWith(offset);
		}
	});
});
