// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	startTableReorderDrag,
	type TableReorderDragContext
} from '$lib/components/blocks/table/table-reorder-drag';

// A second touch's pointerup must not end a drag it didn't start: the shared
// controller filters up/cancel to the pointerId that opened the drag. Without the
// filter a foreign pointerup commits someone else's reorder.

interface TestLine {
	left: number;
	top: number;
	width: number;
}

function pointerEvent(
	type: string,
	pointerId: number,
	coords?: { clientX: number; clientY: number }
) {
	const event = new MouseEvent(type, coords) as MouseEvent & { pointerId: number };
	Object.defineProperty(event, 'pointerId', { value: pointerId });
	return event as unknown as PointerEvent;
}

describe('startTableReorderDrag — pointerId guard', () => {
	const realRaf = globalThis.requestAnimationFrame;
	const realCancel = globalThis.cancelAnimationFrame;
	afterEach(() => {
		globalThis.requestAnimationFrame = realRaf;
		globalThis.cancelAnimationFrame = realCancel;
	});

	it('ignores a pointerup from a different pointer and commits only on the owning pointer', () => {
		let rafCb: FrameRequestCallback | null = null;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCb = cb;
			return 1;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

		const commit = vi.fn();
		const ctx: TableReorderDragContext<TestLine> = {
			from: 2,
			process: () => ({ line: { left: 0, top: 0, width: 100 }, dropTo: 1 }),
			autoScrollAxis: 'both',
			getScrollContainer: () => null,
			setLine: () => {},
			onDragRecognized: () => {},
			commit
		};

		startTableReorderDrag(pointerEvent('pointerdown', 1, { clientX: 10, clientY: 10 }), ctx);

		// Cross the drag threshold and flush the coalescing rAF so dropTo is set.
		document.dispatchEvent(pointerEvent('pointermove', 1, { clientX: 10, clientY: 50 }));
		expect(rafCb).not.toBeNull();
		rafCb!(0);

		// A stray second touch releasing must not commit this drag.
		document.dispatchEvent(pointerEvent('pointerup', 2, { clientX: 10, clientY: 50 }));
		expect(commit).not.toHaveBeenCalled();

		// The owning pointer's release commits.
		document.dispatchEvent(pointerEvent('pointerup', 1, { clientX: 10, clientY: 50 }));
		expect(commit).toHaveBeenCalledWith(2, 1);
		expect(commit).toHaveBeenCalledTimes(1);
	});
});
