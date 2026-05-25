import { describe, it, expect, vi } from 'vitest';
import {
	dispatchMoveFocus,
	dispatchFocusByPath,
	dispatchFocusAtColumn
} from '../../editor-actions/focus-dispatch';
import type { FocusActions } from '../../action-contracts';
import { CURSOR_END } from '../../block-component';
import { mockRef, makeStickyColumn } from '../harness/editor-actions';

describe('dispatchMoveFocus', () => {
	it('delegates upward when innerIndex < 0', async () => {
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([mockRef({ focus: vi.fn() })], -1, 'end', makeStickyColumn(), {
			focus: parentFocus,
			index: 5
		});
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(4, 'end');
	});

	it('delegates upward when innerIndex >= refs.length', async () => {
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([mockRef({ focus: vi.fn() })], 1, 'start', makeStickyColumn(), {
			focus: parentFocus,
			index: 5
		});
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(6, 'start');
	});

	it('routes numeric position to child.focus(offset)', async () => {
		const child = mockRef({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, 3, makeStickyColumn(), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(3);
	});

	it("routes 'end' position to child.focus(CURSOR_END)", async () => {
		const child = mockRef({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, 'end', makeStickyColumn(), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky-column variant uses focusAtColumn when sticky X is set', async () => {
		const child = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'above' }, makeStickyColumn(42), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(child.focus).not.toHaveBeenCalled();
	});

	it('sticky-column variant falls back to focus(0) when from=above and no sticky X', async () => {
		const child = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'above' }, makeStickyColumn(null), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focusAtColumn).not.toHaveBeenCalled();
		expect(child.focus).toHaveBeenCalledWith(0);
	});

	it('sticky-column variant falls back to CURSOR_END when from=below and child lacks focusAtColumn', async () => {
		const child = mockRef({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'below' }, makeStickyColumn(42), {
			focus: { moveFocus: vi.fn() },
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('skips non-focusable blocks without delegating upward', async () => {
		const child = mockRef({ focus: vi.fn(), focusable: false });
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([child], 0, 'start', makeStickyColumn(), {
			focus: parentFocus,
			index: 0
		});
		expect(child.focus).not.toHaveBeenCalled();
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	// Pins the contract: dispatcher no-ops on a non-focusable target.
	// Traversal through non-focusable blocks is the caller's responsibility.
	it('non-focusable at target + focusable sibling: current dispatcher no-ops on the target', async () => {
		const nonFocusable = mockRef({ focus: vi.fn(), focusable: false });
		const focusable = mockRef({ focus: vi.fn(), focusable: true });
		const parentFocus: FocusActions = { moveFocus: vi.fn() };
		await dispatchMoveFocus([nonFocusable, focusable], 0, 'start', makeStickyColumn(), {
			focus: parentFocus,
			index: 0
		});
		expect(nonFocusable.focus).not.toHaveBeenCalled();
		expect(focusable.focus).not.toHaveBeenCalled();
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});
});

describe('dispatchFocusByPath', () => {
	it('single-level path calls refs[first].focus(offset)', () => {
		const leaf = mockRef({ focus: vi.fn() });
		dispatchFocusByPath([mockRef({ focus: vi.fn() }), leaf], [1], 7);
		expect(leaf.focus).toHaveBeenCalledWith(7);
	});

	it('multi-level path recurses via child.focusByPath', () => {
		const focusByPath = vi.fn();
		const child = mockRef({ focus: vi.fn(), focusByPath });
		dispatchFocusByPath([child], [0, 2], 5);
		expect(focusByPath).toHaveBeenCalledWith([2], 5);
	});

	it('empty path calls refs[0].focus(offset)', () => {
		const first = mockRef({ focus: vi.fn() });
		dispatchFocusByPath([first, mockRef({ focus: vi.fn() })], [], 3);
		expect(first.focus).toHaveBeenCalledWith(3);
	});

	it('no-op on missing child ref', () => {
		expect(() => dispatchFocusByPath([undefined, undefined], [1], 5)).not.toThrow();
	});
});

describe('dispatchFocusAtColumn', () => {
	it('from=above routes to first child', () => {
		const first = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		const last = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'above');
		expect(first.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(last.focusAtColumn).not.toHaveBeenCalled();
	});

	it('from=below routes to last child', () => {
		const first = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		const last = mockRef({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'below');
		expect(last.focusAtColumn).toHaveBeenCalledWith(42, 'below');
		expect(first.focusAtColumn).not.toHaveBeenCalled();
	});

	it('falls back to focus(0) from above when child lacks focusAtColumn', () => {
		const first = mockRef({ focus: vi.fn() });
		dispatchFocusAtColumn([first], 42, 'above');
		expect(first.focus).toHaveBeenCalledWith(0);
	});

	it('falls back to focus(CURSOR_END) from below when child lacks focusAtColumn', () => {
		const last = mockRef({ focus: vi.fn() });
		dispatchFocusAtColumn([last], 42, 'below');
		expect(last.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('empty refs array is a no-op', () => {
		expect(() => dispatchFocusAtColumn([], 42, 'above')).not.toThrow();
	});
});
