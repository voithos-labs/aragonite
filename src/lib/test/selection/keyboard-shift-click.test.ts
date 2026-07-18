// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// handleShiftClick reads two DOM seams — the click's caret offset and the
// previously-focused block's anchor caret. Both need a laid-out contenteditable
// (caretRangeFromPoint, a live native range) that jsdom cannot provide, so mock
// them and exercise the branch logic: cross-block extend, the seam collapse when
// the click lands back on the anchor block, and the native-owned same-block case.
vi.mock('../../selection/native-bridge', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../selection/native-bridge')>()),
	offsetFromViewportPoint: vi.fn(),
	readNativeCaretInBlock: vi.fn()
}));

import { createSelectionState } from '../../selection/selection-state.svelte';
import { handleShiftClick } from '../../selection/keyboard-extend';
import { offsetFromViewportPoint, readNativeCaretInBlock } from '../../selection/native-bridge';
import { parse } from '../../core/parser';
import type { Document } from '../../core/nodes';

const clickOffset = vi.mocked(offsetFromViewportPoint);
const anchorCaret = vi.mocked(readNativeCaretInBlock);
const el = () => document.createElement('div');

function stateOver(doc: Document) {
	return createSelectionState({ getDoc: () => doc });
}

beforeEach(() => {
	clickOffset.mockReset();
	anchorCaret.mockReset();
});

describe('handleShiftClick', () => {
	it('extends the active cross-block focus to the clicked point', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 0 });
		clickOffset.mockReturnValue(2);

		expect(handleShiftClick(s, el(), [2], 0, 0, el(), [0])).toBe(true);
		expect(s.focus).toEqual({ path: [2], offset: 2 });
	});

	it('collapses when a cross-block shift-click lands back on the anchor block', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		s.enterCrossBlock({ path: [0], offset: 0 }, { path: [2], offset: 1 });
		clickOffset.mockReturnValue(3);

		expect(handleShiftClick(s, el(), [0], 0, 0, el(), [2])).toBe(true);
		expect(s.isCrossBlock).toBe(false);
		expect(s.focus).toBeNull();
	});

	it('defers to the native single-block range when the click stays in the anchor block', () => {
		const s = stateOver(parse('alpha\n\nbeta\n'));
		clickOffset.mockReturnValue(2);
		anchorCaret.mockReturnValue({ path: [1], offset: 0 });

		expect(handleShiftClick(s, el(), [1], 0, 0, el(), [1])).toBe(false);
		expect(s.isCrossBlock).toBe(false);
	});

	it('enters cross-block from the previous caret when the click crosses blocks', () => {
		const s = stateOver(parse('alpha\n\nbeta\n\ncc\n'));
		clickOffset.mockReturnValue(1);
		anchorCaret.mockReturnValue({ path: [0], offset: 2 });

		expect(handleShiftClick(s, el(), [2], 0, 0, el(), [0])).toBe(true);
		expect(s.isCrossBlock).toBe(true);
		expect(s.anchor).toEqual({ path: [0], offset: 2 });
		expect(s.focus).toEqual({ path: [2], offset: 1 });
	});
});
