// Container-scope parity for the gap stop: the dispatcher asks the same question at its
// own boundaries, including the two it used to answer only by delegating upward.
import { describe, it, expect, vi } from 'vitest';
import { dispatchMoveFocus } from '../../../editor-actions/focus/focus-dispatch';
import { mockRef, makeStickyColumn, makeStubFocus } from '../../harness/editor-actions';
import type { FocusPosition } from '../../../block-component';
import type { MoveFocusOptions } from '../../../action-contracts';

function dispatch(
	innerIndex: number,
	position: FocusPosition,
	stops: boolean,
	options?: MoveFocusOptions
) {
	const parentFocus = makeStubFocus();
	const child = mockRef({ focus: vi.fn() });
	const gapStop = vi.fn(() => stops);
	const done = dispatchMoveFocus(
		[child, child],
		innerIndex,
		position,
		makeStickyColumn(),
		{ focus: parentFocus, index: 3 },
		{ childCount: 2, options, gapStop }
	);
	return { done, parentFocus, child, gapStop };
}

describe('dispatchMoveFocus — scope-edge gap stops', () => {
	it('stops at the scope start instead of delegating upward', async () => {
		const d = dispatch(-1, 'end', true);
		await d.done;

		expect(d.gapStop).toHaveBeenCalledWith(0);
		expect(d.parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	it('delegates upward when the scope start is ineligible', async () => {
		const d = dispatch(-1, 'end', false);
		await d.done;

		expect(d.parentFocus.moveFocus).toHaveBeenCalledWith(2, 'end');
	});

	// childCount, not refs.length: the two diverge for one render cycle after a
	// structural op, and the scope-end boundary is the child count.
	it('stops at the scope end instead of delegating upward', async () => {
		const d = dispatch(2, 'start', true);
		await d.done;

		expect(d.gapStop).toHaveBeenCalledWith(2);
		expect(d.parentFocus.moveFocus).not.toHaveBeenCalled();
	});

	it('delegates upward when the scope end is ineligible', async () => {
		const d = dispatch(2, 'start', false);
		await d.done;

		expect(d.parentFocus.moveFocus).toHaveBeenCalledWith(4, 'start');
	});
});

describe('dispatchMoveFocus — between-sibling gap stops', () => {
	it('stops before entering the target sibling', async () => {
		const d = dispatch(1, 'start', true);
		await d.done;

		expect(d.gapStop).toHaveBeenCalledWith(1);
		expect(d.child.focus).not.toHaveBeenCalled();
	});

	it('enters the sibling when the boundary is ineligible', async () => {
		const d = dispatch(1, 'start', false);
		await d.done;

		expect(d.child.focus).toHaveBeenCalled();
	});

	it('reads the boundary on the far side when moving backward', async () => {
		const d = dispatch(0, 'end', true);
		await d.done;

		expect(d.gapStop).toHaveBeenCalledWith(1);
	});

	it('never asks on a targeted landing', async () => {
		const d = dispatch(1, 4, true);
		await d.done;

		expect(d.gapStop).not.toHaveBeenCalled();
		expect(d.child.focus).toHaveBeenCalledWith(4);
	});

	it('never asks when the caller is leaving a gap', async () => {
		const d = dispatch(1, 'start', true, { skipGapStop: true });
		await d.done;

		expect(d.gapStop).not.toHaveBeenCalled();
		expect(d.child.focus).toHaveBeenCalled();
	});
});
