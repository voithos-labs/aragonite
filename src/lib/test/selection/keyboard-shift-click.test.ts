// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `handleShiftClick` makes two DOM reads (the click's caret offset and the previously focused
// block's anchor caret) that need a laid-out contenteditable jsdom cannot provide, so they are
// mocked and the branch logic exercised instead.
vi.mock('../../selection/native-bridge', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../selection/native-bridge')>()),
	readNativeCaretInBlock: vi.fn(),
	applySingleBlockRange: vi.fn()
}));
vi.mock('../../cursor/point-offset', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../cursor/point-offset')>()),
	offsetFromViewportPoint: vi.fn()
}));

import { createSelectionState } from '../../selection/selection-state.svelte';
import { handleShiftClick } from '../../selection/keyboard-extend';
import { applySingleBlockRange, readNativeCaretInBlock } from '../../selection/native-bridge';
import type { SelectedWidgetRange } from '../../selection/primitives';
import { offsetFromViewportPoint } from '../../cursor/point-offset';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';

const clickOffset = vi.mocked(offsetFromViewportPoint);
const anchorCaret = vi.mocked(readNativeCaretInBlock);
const sameBlockRange = vi.mocked(applySingleBlockRange);
const el = () => document.createElement('div');
// No image is selected whole in these cases.
const NO_SELECTED_WIDGET = { range: () => null, clear: () => {} };

function stateOver(doc: Document) {
	return createSelectionState({ getDoc: () => doc });
}

beforeEach(() => {
	clickOffset.mockReset();
	anchorCaret.mockReset();
	sameBlockRange.mockReset();
});

describe('handleShiftClick', () => {
	it('extends the active cross-block focus to the clicked point', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		clickOffset.mockReturnValue(2);

		expect(handleShiftClick(s, el(), [2], 0, 0, el(), [0], NO_SELECTED_WIDGET)).toBe(true);
		expect(s.focus).toEqual({ path: [2], offset: 2 });
	});

	it('collapses when a cross-block shift-click lands back on the anchor block', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 1 });
		clickOffset.mockReturnValue(3);

		expect(handleShiftClick(s, el(), [0], 0, 0, el(), [2], NO_SELECTED_WIDGET)).toBe(true);
		expect(s.isCrossBlock).toBe(false);
		expect(s.focus).toBeNull();
	});

	it('defers to the native single-block range when the click stays in the anchor block', () => {
		const s = stateOver(parse('alpha\n\nbeta\n'));
		clickOffset.mockReturnValue(2);
		anchorCaret.mockReturnValue({ path: [1], offset: 0 });

		expect(handleShiftClick(s, el(), [1], 0, 0, el(), [1], NO_SELECTED_WIDGET)).toBe(false);
		expect(s.isCrossBlock).toBe(false);
	});

	it('enters cross-block from the previous caret when the click crosses blocks', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		clickOffset.mockReturnValue(1);
		anchorCaret.mockReturnValue({ path: [0], offset: 2 });

		expect(handleShiftClick(s, el(), [2], 0, 0, el(), [0], NO_SELECTED_WIDGET)).toBe(true);
		expect(s.isCrossBlock).toBe(true);
		expect(s.anchor).toEqual({ path: [0], offset: 2 });
		expect(s.focus).toEqual({ path: [2], offset: 1 });
	});
});

// Miss-analysis: every case here grew from a caret the previous block still held, so none asked
// where a shift-press anchors while an image is selected whole and no caret exists.
describe('handleShiftClick with an image selected whole', () => {
	// `before ![pic](img) after`: the image spans raw 7 to 18 of block 0.
	const IMAGE: SelectedWidgetRange = { path: [0], start: 7, end: 18 };

	function imageHandle() {
		const cleared = { count: 0 };
		return {
			cleared,
			handle: { range: () => IMAGE, clear: () => void cleared.count++ }
		};
	}

	it.each([
		['after the image, from its start', 22, 7],
		['before the image, from its end', 2, 18]
	])('a press in its block %s selects to the press', (_, pressAt, anchorAt) => {
		const s = stateOver(parse('before ![pic](img) after\n'));
		const block = el();
		const { cleared, handle } = imageHandle();
		clickOffset.mockReturnValue(pressAt);

		expect(handleShiftClick(s, block, [0], 0, 0, null, null, handle)).toBe(true);
		expect(sameBlockRange).toHaveBeenCalledWith(block, anchorAt, pressAt);
		expect(cleared.count).toBe(1);
		expect(s.isCrossBlock).toBe(false);
	});

	it('a press in a later block enters a cross-block range from the image start', () => {
		const s = stateOver(parse('before ![pic](img) after\n\nnext\n'));
		const { cleared, handle } = imageHandle();
		clickOffset.mockReturnValue(2);

		expect(handleShiftClick(s, el(), [1], 0, 0, null, null, handle)).toBe(true);
		expect(s.anchor).toEqual({ path: [0], offset: 7 });
		expect(s.focus).toEqual({ path: [1], offset: 2 });
		expect(cleared.count).toBe(1);
	});
});
