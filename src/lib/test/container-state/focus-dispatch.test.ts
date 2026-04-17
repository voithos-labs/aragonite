import { describe, it, expect, vi } from 'vitest';
import {
	dispatchMoveFocus,
	dispatchFocusByPath,
	dispatchFocusAtColumn
} from '../../components/blocks/container-state/focus-dispatch';
import type { BlockComponent, FocusActions } from '../../editor-types';
import { CURSOR_END } from '../../editor-types';
import type { StickyColumnState } from '../../contenteditable/sticky-column';

function fakeBlock(overrides: Partial<BlockComponent> = {}): BlockComponent {
	return {
		editable: true,
		focusable: true,
		focus: vi.fn(),
		getCursorOffset: vi.fn(() => null),
		...overrides
	};
}

function fakeStickyColumn(x: number | null = null): StickyColumnState {
	return {
		get: () => x,
		capture: vi.fn(),
		reset: vi.fn()
	};
}

describe('dispatchMoveFocus', () => {
	it('delegates upward when innerIndex < 0', async () => {
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([fakeBlock()], -1, 'end', fakeStickyColumn(), {
			focus: parentFocus,
			index: 5
		});
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(4, 'end');
	});

	it('delegates upward when innerIndex >= refs.length', async () => {
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([fakeBlock()], 1, 'start', fakeStickyColumn(), {
			focus: parentFocus,
			index: 5
		});
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(6, 'start');
	});

	it('routes numeric position to child.focus(offset)', async () => {
		const child = fakeBlock();
		await dispatchMoveFocus([child], 0, 3, fakeStickyColumn(), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(3);
	});

	it("routes 'end' position to child.focus(CURSOR_END)", async () => {
		const child = fakeBlock();
		await dispatchMoveFocus([child], 0, 'end', fakeStickyColumn(), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky-column variant uses focusAtColumn when sticky X is set', async () => {
		const child = fakeBlock({ focusAtColumn: vi.fn() });
		await dispatchMoveFocus(
			[child],
			0,
			{ stickyColumnFrom: 'above' },
			fakeStickyColumn(42),
			{ focus: { moveFocus: vi.fn() }, index: 0 }
		);
		expect(child.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(child.focus).not.toHaveBeenCalled();
	});

	it('sticky-column variant falls back to focus(0) when from=above and no sticky X', async () => {
		const child = fakeBlock({ focusAtColumn: vi.fn() });
		await dispatchMoveFocus(
			[child],
			0,
			{ stickyColumnFrom: 'above' },
			fakeStickyColumn(null),
			{ focus: { moveFocus: vi.fn() }, index: 0 }
		);
		expect(child.focusAtColumn).not.toHaveBeenCalled();
		expect(child.focus).toHaveBeenCalledWith(0);
	});

	it('sticky-column variant falls back to CURSOR_END when from=below and child lacks focusAtColumn', async () => {
		const child = fakeBlock();
		await dispatchMoveFocus(
			[child],
			0,
			{ stickyColumnFrom: 'below' },
			fakeStickyColumn(42),
			{ focus: { moveFocus: vi.fn() }, index: 0 }
		);
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('skips non-focusable blocks without delegating upward', async () => {
		const child = fakeBlock({ focusable: false });
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([child], 0, 'start', fakeStickyColumn(), {
			focus: parentFocus,
			index: 0
		});
		expect(child.focus).not.toHaveBeenCalled();
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	// Regression for a realistic scenario: a list with a non-focusable
	// block at the requested index, targeted with a focusable next sibling.
	// The dispatcher currently no-ops on the non-focusable ref rather than
	// advancing — pinning that contract so any future "skip non-focusable
	// and advance" change has to explicitly update this test.
	it('non-focusable at target + focusable sibling: current dispatcher no-ops on the target', async () => {
		const nonFocusable = fakeBlock({ focusable: false });
		const focusable = fakeBlock({ focusable: true });
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([nonFocusable, focusable], 0, 'start', fakeStickyColumn(), {
			focus: parentFocus,
			index: 0
		});
		// Current contract: dispatcher does nothing on a non-focusable target.
		// Traversal through non-focusable blocks is the caller's responsibility.
		expect(nonFocusable.focus).not.toHaveBeenCalled();
		expect(focusable.focus).not.toHaveBeenCalled();
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});
});

describe('dispatchFocusByPath', () => {
	it('single-level path calls refs[first].focus(offset)', () => {
		const leaf = fakeBlock();
		dispatchFocusByPath([fakeBlock(), leaf], [1], 7);
		expect(leaf.focus).toHaveBeenCalledWith(7);
	});

	it('multi-level path recurses via child.focusByPath', () => {
		const focusByPath = vi.fn();
		const child = fakeBlock({ focusByPath });
		dispatchFocusByPath([child], [0, 2], 5);
		expect(focusByPath).toHaveBeenCalledWith([2], 5);
	});

	it('empty path calls refs[0].focus(offset)', () => {
		const first = fakeBlock();
		dispatchFocusByPath([first, fakeBlock()], [], 3);
		expect(first.focus).toHaveBeenCalledWith(3);
	});

	it('no-op on missing child ref', () => {
		expect(() => dispatchFocusByPath([undefined, undefined], [1], 5)).not.toThrow();
	});
});

describe('dispatchFocusAtColumn', () => {
	it('from=above routes to first child', () => {
		const first = fakeBlock({ focusAtColumn: vi.fn() });
		const last = fakeBlock({ focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'above');
		expect(first.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(last.focusAtColumn).not.toHaveBeenCalled();
	});

	it('from=below routes to last child', () => {
		const first = fakeBlock({ focusAtColumn: vi.fn() });
		const last = fakeBlock({ focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'below');
		expect(last.focusAtColumn).toHaveBeenCalledWith(42, 'below');
		expect(first.focusAtColumn).not.toHaveBeenCalled();
	});

	it('falls back to focus(0) from above when child lacks focusAtColumn', () => {
		const first = fakeBlock();
		dispatchFocusAtColumn([first], 42, 'above');
		expect(first.focus).toHaveBeenCalledWith(0);
	});

	it('falls back to focus(CURSOR_END) from below when child lacks focusAtColumn', () => {
		const last = fakeBlock();
		dispatchFocusAtColumn([last], 42, 'below');
		expect(last.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('empty refs array is a no-op', () => {
		expect(() => dispatchFocusAtColumn([], 42, 'above')).not.toThrow();
	});
});
