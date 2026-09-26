import { describe, it, expect, vi } from 'vitest';
import {
	dispatchMoveFocus,
	dispatchFocusByPath,
	dispatchFocusAtColumn
} from '$lib/editor-actions/focus/focus-dispatch';
import { CURSOR_END, CURSOR_START } from '$lib/block-component';
import {
	stubBlockComponent,
	makeCaretMemory,
	makeStubFocus
} from '$lib/test/harness/editor-actions';

describe('dispatchMoveFocus', () => {
	it('delegates upward when innerIndex < 0', async () => {
		const parentFocus = makeStubFocus();
		await dispatchMoveFocus(
			[stubBlockComponent({ focus: vi.fn() })],
			-1,
			'end',
			makeCaretMemory(),
			{
				focus: parentFocus,
				index: 5
			}
		);
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(4, 'end');
	});

	it('delegates upward when innerIndex >= refs.length', async () => {
		const parentFocus = makeStubFocus();
		await dispatchMoveFocus(
			[stubBlockComponent({ focus: vi.fn() })],
			1,
			'start',
			makeCaretMemory(),
			{
				focus: parentFocus,
				index: 5
			}
		);
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(6, 'start');
	});

	it('forwards moveFocus options to the parent on upward delegation', async () => {
		const parentFocus = makeStubFocus();
		await dispatchMoveFocus(
			[stubBlockComponent({ focus: vi.fn() })],
			1,
			'start',
			makeCaretMemory(),
			{ focus: parentFocus, index: 5 },
			{ options: { append: false } }
		);
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(6, 'start', { append: false });
	});

	it('routes numeric position to child.focus(offset)', async () => {
		const child = stubBlockComponent({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, 3, makeCaretMemory(), {
			focus: makeStubFocus(),
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(3);
	});

	it("routes 'end' position to child.focus(CURSOR_END)", async () => {
		const child = stubBlockComponent({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, 'end', makeCaretMemory(), {
			focus: makeStubFocus(),
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('sticky-column variant uses focusAtColumn when sticky X is set', async () => {
		const child = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'above' }, makeCaretMemory(42), {
			focus: makeStubFocus(),
			index: 0
		});
		expect(child.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(child.focus).not.toHaveBeenCalled();
	});

	it('sticky-column variant falls back to focus(CURSOR_START) when from=above and no sticky X', async () => {
		const child = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'above' }, makeCaretMemory(null), {
			focus: makeStubFocus(),
			index: 0
		});
		expect(child.focusAtColumn).not.toHaveBeenCalled();
		expect(child.focus).toHaveBeenCalledWith(CURSOR_START);
	});

	it('sticky-column variant falls back to CURSOR_END when from=below and child lacks focusAtColumn', async () => {
		const child = stubBlockComponent({ focus: vi.fn() });
		await dispatchMoveFocus([child], 0, { stickyColumnFrom: 'below' }, makeCaretMemory(42), {
			focus: makeStubFocus(),
			index: 0
		});
		expect(child.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	// A target that cannot take focus must not stop the move (`docs/design/editor.md`
	// § Focus traversal); with no focusable sibling ahead, the walk hands up to the parent.
	it('non-focusable at the boundary: delegates upward in the move direction', async () => {
		const child = stubBlockComponent({ focus: vi.fn(), focusable: false });
		const parentFocus = makeStubFocus();
		await dispatchMoveFocus([child], 0, 'start', makeCaretMemory(), {
			focus: parentFocus,
			index: 0
		});
		expect(child.focus).not.toHaveBeenCalled();
		expect(parentFocus.moveFocus).toHaveBeenCalledWith(1, 'start');
	});

	// The interior counterpart: nothing goes to the parent while a focusable sibling remains.
	it('non-focusable mid-chain: skips to the next focusable sibling', async () => {
		const nonFocusable = stubBlockComponent({ focus: vi.fn(), focusable: false });
		const focusable = stubBlockComponent({ focus: vi.fn(), focusable: true });
		const parentFocus = makeStubFocus();
		await dispatchMoveFocus([nonFocusable, focusable], 0, 'start', makeCaretMemory(), {
			focus: parentFocus,
			index: 0
		});
		expect(nonFocusable.focus).not.toHaveBeenCalled();
		expect(focusable.focus).toHaveBeenCalledWith(CURSOR_START);
		expect(parentFocus.moveFocus).not.toHaveBeenCalled();
	});
});

describe('dispatchFocusByPath', () => {
	it('single-level path calls refs[first].focus(offset)', () => {
		const leaf = stubBlockComponent({ focus: vi.fn() });
		dispatchFocusByPath([stubBlockComponent({ focus: vi.fn() }), leaf], [1], 7);
		expect(leaf.focus).toHaveBeenCalledWith(7);
	});

	it('multi-level path recurses via child.focusByPath', () => {
		const focusByPath = vi.fn();
		const child = stubBlockComponent({ focus: vi.fn(), focusByPath });
		dispatchFocusByPath([child], [0, 2], 5);
		expect(focusByPath).toHaveBeenCalledWith([2], 5);
	});

	it('empty path calls refs[0].focus(offset)', () => {
		const first = stubBlockComponent({ focus: vi.fn() });
		dispatchFocusByPath([first, stubBlockComponent({ focus: vi.fn() })], [], 3);
		expect(first.focus).toHaveBeenCalledWith(3);
	});

	it('no-op on missing child ref', () => {
		expect(() => dispatchFocusByPath([undefined, undefined], [1], 5)).not.toThrow();
	});
});

describe('dispatchFocusAtColumn', () => {
	it('from=above routes to first child', () => {
		const first = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		const last = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'above');
		expect(first.focusAtColumn).toHaveBeenCalledWith(42, 'above');
		expect(last.focusAtColumn).not.toHaveBeenCalled();
	});

	it('from=below routes to last child', () => {
		const first = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		const last = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([first, last], 42, 'below');
		expect(last.focusAtColumn).toHaveBeenCalledWith(42, 'below');
		expect(first.focusAtColumn).not.toHaveBeenCalled();
	});

	it('falls back to focus(CURSOR_START) from above when child lacks focusAtColumn', () => {
		const first = stubBlockComponent({ focus: vi.fn() });
		dispatchFocusAtColumn([first], 42, 'above');
		expect(first.focus).toHaveBeenCalledWith(CURSOR_START);
	});

	it('falls back to focus(CURSOR_END) from below when child lacks focusAtColumn', () => {
		const last = stubBlockComponent({ focus: vi.fn() });
		dispatchFocusAtColumn([last], 42, 'below');
		expect(last.focus).toHaveBeenCalledWith(CURSOR_END);
	});

	it('passes over a vertically-transparent child', () => {
		const transparent = stubBlockComponent({ focus: vi.fn(), isVerticallyTransparent: () => true });
		const text = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn([transparent, text], 42, 'above');
		expect(transparent.focus).not.toHaveBeenCalled();
		expect(text.focusAtColumn).toHaveBeenCalledWith(42, 'above');
	});

	// Miss-analysis (#326): the container entry and the per-block arrival each decided this on
	// their own, and no test compared them, so the two vertical paths drifted apart.
	it.each([
		['above', 'start'],
		['below', 'end']
	] as const)('entry from %s stops on a transparent child, at its %s edge', (from, side) => {
		const image = stubBlockComponent({
			focus: vi.fn(),
			isVerticallyTransparent: () => true,
			enterEdgeWidget: vi.fn(() => true)
		});
		const text = stubBlockComponent({ focus: vi.fn(), focusAtColumn: vi.fn() });
		dispatchFocusAtColumn(from === 'above' ? [image, text] : [text, image], 42, from);
		expect(image.enterEdgeWidget).toHaveBeenCalledWith(side);
		expect(text.focusAtColumn).not.toHaveBeenCalled();
	});

	it('empty refs array is a no-op', () => {
		expect(() => dispatchFocusAtColumn([], 42, 'above')).not.toThrow();
	});
});
