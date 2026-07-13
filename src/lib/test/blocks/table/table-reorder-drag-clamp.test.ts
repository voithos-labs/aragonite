// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	startRowReorderDrag,
	type RowReorderDragContext
} from '$lib/components/blocks/table/table-reorder-drag';

// The into-header clamp, unit-tested at the drag controller rather than through a
// flaky "drag a body row into the header region" e2e. A drag whose pointer rises
// above the fixed header lands on gap 1 (rowEdges[1]) and commits (from, 1) —
// never above the header.

describe('startRowReorderDrag — into-header clamp', () => {
	const realRaf = globalThis.requestAnimationFrame;
	const realCancel = globalThis.cancelAnimationFrame;
	afterEach(() => {
		globalThis.requestAnimationFrame = realRaf;
		globalThis.cancelAnimationFrame = realCancel;
	});

	it('clamps a drag above the header to gap 1 and commits (from, 1)', () => {
		let rafCb: FrameRequestCallback | null = null;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCb = cb;
			return 1;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

		const setLine = vi.fn();
		const commit = vi.fn();
		// 4 fully-mounted rows: header at 0, bodies 1..3. rowEdges hold each row's
		// top plus the last bottom; gapIndices map each edge to its absolute gap.
		const rowEdges = [100, 130, 160, 190, 220];
		const ctx: RowReorderDragContext = {
			fromRowIdx: 2,
			getRowCount: () => 4,
			getGeometry: () => ({ rowEdges, gapIndices: [0, 1, 2, 3, 4], left: 0, width: 200 }),
			getScrollContainer: () => null,
			setLine,
			onDragRecognized: () => {},
			commit
		};

		startRowReorderDrag(
			new MouseEvent('pointerdown', { clientX: 10, clientY: 150 }) as unknown as PointerEvent,
			ctx
		);

		// Move the pointer above the header (y=50 < rowEdges[0]=100), past the 4px threshold.
		document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 50 }));
		expect(rafCb).not.toBeNull();
		rafCb!(0);
		document.dispatchEvent(new MouseEvent('pointerup', {}));

		const lineTops = setLine.mock.calls
			.map((c) => (c[0] as { top: number } | null)?.top)
			.filter((t): t is number => t != null);
		expect(lineTops.at(-1)).toBe(rowEdges[1]);
		expect(commit).toHaveBeenCalledWith(2, 1);
	});
});
