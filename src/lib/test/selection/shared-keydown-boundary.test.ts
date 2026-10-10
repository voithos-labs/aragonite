// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shift+Arrow boundary detection reads the focus offset, not the anchor, so a forward selection
// anchored mid-block still crosses once the focus reaches the edge.
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
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { commandContext } from '#lib/test/support/command-context.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

const toPrev = vi.mocked(extendFocusToPreviousBlock);
const toNext = vi.mocked(extendFocusToNextBlock);

function makeCtx(over: {
	cursorOffset: number | null;
	focusOffset: number | null;
	textLen: number;
}): SharedKeydownContext {
	const doc = parse('a\n\nb\n');
	// Cast only the members this fixture does not stand up, never the whole context, so a new
	// required reader fails to type-check here.
	return {
		caretWriter: testCaretWriter,
		// No plugins stood up here, so every installed one is active.
		commands: commandContext(),
		reading: fixtureReading(),
		getEl: () => document.createElement('div'),
		getCursorOffset: () => over.cursorOffset,
		getFocusOffset: () => over.focusOffset,
		// A detached element reads as no presentation root, so the bounds never walk it.
		getTextLen: () => over.textLen,
		getMyPath: () => [1],
		getIndex: () => 1,
		crossBlock: {
			handleKeyDown: async () => false,
			handleBeforeInput: async () => false
		} as unknown as SharedKeydownContext['crossBlock'],
		selection: {
			resetSelectAllCount: () => {}
		} as unknown as SharedKeydownContext['selection'],
		caretMemory: createCaretMemory(),
		history: {} as SharedKeydownContext['history'],
		focus: {} as SharedKeydownContext['focus'],
		getDoc: () => doc,
		scrollOwner: { place: () => ({ scroll: async () => true }) }
	};
}

function keydown(key: string): KeyboardEvent {
	return new KeyboardEvent('keydown', { key, shiftKey: true, cancelable: true });
}

beforeEach(() => {
	toPrev.mockReset();
	toNext.mockReset();
});

describe('handleSharedKeydown boundary detection', () => {
	it('Shift+ArrowLeft crosses on the focus offset even when the anchor is mid-block', async () => {
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
