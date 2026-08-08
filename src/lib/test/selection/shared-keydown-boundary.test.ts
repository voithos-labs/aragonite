// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The dispatch prelude's boundary-detection asymmetry: Shift+Arrow reads the FOCUS offset, not the
// anchor, so a forward selection whose anchor sits mid-block still crosses once the focus reaches
// the edge. Spy on the cross-block extenders to observe the decision without DOM geometry.
vi.mock('../../selection/keyboard-extend', () => ({
	extendFocusToNextBlock: vi.fn(),
	extendFocusToPreviousBlock: vi.fn(),
	scrollFocusBlockIntoView: vi.fn()
}));

import { handleSharedKeydown, type SharedKeydownContext } from '../../selection/shared-keydown';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock
} from '../../selection/keyboard-extend';
import { parse } from '../../core/parser';
import { createStickyColumnState } from '../../cursor/sticky-column';
import { createEdgeAffinityState } from '../../cursor/edge-affinity';

const toPrev = vi.mocked(extendFocusToPreviousBlock);
const toNext = vi.mocked(extendFocusToNextBlock);

function makeCtx(over: {
	cursorOffset: number | null;
	focusOffset: number | null;
	textLen: number;
}): SharedKeydownContext {
	const doc = parse('a\n\nb\n');
	return {
		getEl: () => document.createElement('div'),
		getCursorOffset: () => over.cursorOffset,
		getFocusOffset: () => over.focusOffset,
		getTextLen: () => over.textLen,
		getMyPath: () => [1],
		getIndex: () => 1,
		crossBlock: { handleKeyDown: async () => false, handleBeforeInput: async () => false },
		selection: { resetSelectAllCount: () => {} },
		stickyColumn: createStickyColumnState(),
		edgeAffinity: createEdgeAffinityState(),
		history: {},
		focus: {},
		getDoc: () => doc,
		getBlockElByPath: () => null
	} as unknown as SharedKeydownContext;
}

function keydown(key: string): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, shiftKey: true, cancelable: true });
}

beforeEach(() => {
	toPrev.mockReset();
	toNext.mockReset();
});

describe('handleSharedKeydown boundary detection', () => {
	it('Shift+ArrowLeft crosses on the FOCUS offset even when the anchor is mid-block', async () => {
		const ctx = makeCtx({ cursorOffset: 5, focusOffset: 0, textLen: 5 });
		const e = keydown('ArrowLeft');
		expect(await handleSharedKeydown(e, ctx)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(toPrev).toHaveBeenCalledTimes(1);
	});

	it('Shift+ArrowLeft does not cross while the focus is still mid-block', async () => {
		const ctx = makeCtx({ cursorOffset: 0, focusOffset: 3, textLen: 5 });
		const e = keydown('ArrowLeft');
		expect(await handleSharedKeydown(e, ctx)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(toPrev).not.toHaveBeenCalled();
	});

	it('Shift+ArrowRight crosses forward once the focus reaches the block end', async () => {
		const ctx = makeCtx({ cursorOffset: 0, focusOffset: 4, textLen: 4 });
		const e = keydown('ArrowRight');
		expect(await handleSharedKeydown(e, ctx)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(toNext).toHaveBeenCalledTimes(1);
	});
});
