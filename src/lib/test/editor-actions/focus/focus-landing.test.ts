import { describe, it, expect, vi } from 'vitest';
import { consumeStickyLanding } from '../../../editor-actions/focus/focus-landing';
import { CURSOR_END } from '../../../block-component';
import { asEditorX } from '../../../cursor/coordinate-spaces';
import { createStickyColumnState, type StickyColumnState } from '../../../cursor/sticky-column';
import { mockRef } from '../../harness/editor-actions';

function capturedSticky(x: number): StickyColumnState {
	const sticky = createStickyColumnState();
	sticky.capture(asEditorX(x));
	return sticky;
}

describe('consumeStickyLanding', () => {
	it('sticky move from above skips a vertically-transparent block downward', async () => {
		const block = mockRef({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(
			block,
			3,
			{ stickyColumnFrom: 'above' },
			createStickyColumnState(),
			retryAt
		);
		expect(retryAt).toHaveBeenCalledWith(4);
		expect(block.focus).not.toHaveBeenCalled();
	});

	it('sticky move from below skips a vertically-transparent block upward', async () => {
		const block = mockRef({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(
			block,
			3,
			{ stickyColumnFrom: 'below' },
			createStickyColumnState(),
			retryAt
		);
		expect(retryAt).toHaveBeenCalledWith(2);
	});

	it('horizontal move lands on a transparent block instead of skipping', async () => {
		const block = mockRef({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const retryAt = vi.fn();
		await consumeStickyLanding(block, 0, 'start', createStickyColumnState(), retryAt);
		expect(retryAt).not.toHaveBeenCalled();
		expect(block.focus).toHaveBeenCalledWith(0);
	});

	for (const side of ['start', 'end'] as const) {
		it(`'${side}' prefers edge-widget entry when the block accepts`, async () => {
			const block = mockRef({ focus: vi.fn(), enterEdgeWidget: vi.fn(() => true) });
			await consumeStickyLanding(block, 0, side, createStickyColumnState(), vi.fn());
			expect(block.enterEdgeWidget).toHaveBeenCalledWith(side);
			expect(block.focus).not.toHaveBeenCalled();
		});
	}

	it('falls through to the caret when enterEdgeWidget declines', async () => {
		const block = mockRef({ focus: vi.fn(), enterEdgeWidget: vi.fn(() => false) });
		await consumeStickyLanding(block, 0, 'end', createStickyColumnState(), vi.fn());
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky move with captured x routes through focusAtColumn', async () => {
		const block = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
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

	it('sticky move with no captured x falls back to focus(0) from above', async () => {
		const block = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'above' },
			createStickyColumnState(),
			vi.fn()
		);
		expect(block.focusAtColumn).not.toHaveBeenCalled();
		expect(block.focus).toHaveBeenCalledWith(0);
	});

	it('sticky move with no captured x falls back to focus(CURSOR_END) from below', async () => {
		const block = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'below' },
			createStickyColumnState(),
			vi.fn()
		);
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky move with captured x but no focusAtColumn falls back by direction', async () => {
		const block = mockRef({ focus: vi.fn() });
		await consumeStickyLanding(
			block,
			0,
			{ stickyColumnFrom: 'below' },
			capturedSticky(42),
			vi.fn()
		);
		expect(block.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('lands numeric / start / end positions at the requested offset', async () => {
		const cases: Array<{ position: number | 'start' | 'end'; offset: number }> = [
			{ position: 7, offset: 7 },
			{ position: 'start', offset: 0 },
			{ position: 'end', offset: CURSOR_END }
		];
		for (const { position, offset } of cases) {
			const block = mockRef({ focus: vi.fn() });
			await consumeStickyLanding(block, 0, position, createStickyColumnState(), vi.fn());
			expect(block.focus).toHaveBeenCalledWith(offset);
		}
	});
});
