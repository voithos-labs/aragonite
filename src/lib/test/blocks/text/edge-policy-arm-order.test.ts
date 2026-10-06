// @vitest-environment jsdom
// The caret-edge dispatch's branch order decides every contested key, so a branch added at the
// wrong rank changes behavior no single branch's tests can see (G4.12).
// Miss-analysis: no test named the order of the branches, so a reordering read as a refactor.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { asRawOffset } from '$lib/cursor/coordinate-spaces';
import { installEdgeDispatchCleanup, makeEdgeDispatch, mountSurface } from './edge-policy-fixture';

function mount(reading: boolean, source = 'hello world\n') {
	const node = parse(source).children[0];
	const el = mountSurface(trimTrailingLineEnding(node.raw));
	const entered: { start: number; end: number }[] = [];
	const harness = makeEdgeDispatch(node, el, {
		hasIslands: () => true,
		isReading: () => reading,
		enterWidget: (widget) => entered.push({ start: widget.start, end: widget.end })
	});
	return { ...harness, node, entered };
}

installEdgeDispatchCleanup();

describe('the declared branch order', () => {
	const { dispatch } = mount(false);

	it('ranks the families as the design states, cut line included', () => {
		expect(dispatch.arms.map((arm) => arm.id)).toEqual([
			'pending-marks',
			'cst-widget',
			'reading-mode',
			'decoration-island',
			'ambient-marker',
			'construct-edge-delete',
			'marker-completion',
			'construct-seat'
		]);
	});

	it('gives every branch a reason, which is what a new entry has to supply', () => {
		expect(dispatch.arms.filter((arm) => arm.reason.trim() === '')).toEqual([]);
	});

	// The reading-mode entry sits in the list, not ahead of it: the two branches above it still
	// run in reading mode, and everything below does nothing. A check at the top loses that half.
	it('reading mode stops the walk at its cut and leaves the key unclaimed', () => {
		const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
		expect(mount(true).dispatch.handleKeydown(e, asRawOffset(11))).toBe(false);
		expect(e.defaultPrevented).toBe(false);
	});

	// The widget branch above the reading-mode entry still selects an entity at the caret, and
	// reads the mode itself to skip only its atomic delete.
	it('enters a widget at the caret in reading mode and commits nothing', () => {
		const b = mount(true, 'a&copy;b\n');
		const e = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
		expect(b.dispatch.handleKeydown(e, asRawOffset(7))).toBe(true);
		expect(b.entered).toEqual([{ start: 1, end: 7 }]);
		expect(b.edits).toEqual([]);
		expect(e.defaultPrevented).toBe(true);
		expect(b.node.raw).toBe('a&copy;b\n');
	});
});
