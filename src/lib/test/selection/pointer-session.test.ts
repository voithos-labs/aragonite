// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createPointerDragSession } from '../../selection/pointer-session';

// The coalescing contract every drag lifecycle inherits: a release flushes the last pending move
// exactly once (a fast flick's final position is not dropped) and never replays a move the frame
// already processed, which would double-commit.

function pointer(
	type: string,
	pointerId: number,
	coords?: { clientX: number; clientY: number }
): PointerEvent {
	const event = new MouseEvent(type, coords) as MouseEvent & { pointerId: number };
	Object.defineProperty(event, 'pointerId', { value: pointerId });
	return event as unknown as PointerEvent;
}

describe('createPointerDragSession — move coalescing', () => {
	const realRaf = globalThis.requestAnimationFrame;
	const realCancel = globalThis.cancelAnimationFrame;
	afterEach(() => {
		globalThis.requestAnimationFrame = realRaf;
		globalThis.cancelAnimationFrame = realCancel;
	});

	function stubRaf(): { runFrame(): void } {
		let cb: FrameRequestCallback | null = null;
		globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
			cb = fn;
			return 1;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
		return {
			runFrame() {
				const fn = cb;
				cb = null;
				fn?.(0);
			}
		};
	}

	function startSession(onMove: (x: number) => void, onEnd?: () => void): void {
		createPointerDragSession(pointer('pointerdown', 1, { clientX: 0, clientY: 0 }), {
			onMove: (p) => onMove(p.clientX),
			onEnd,
			autoScroll: { getTargets: () => [] }
		});
	}

	it('flushes the latest coalesced move before onEnd on release', () => {
		stubRaf();
		const seen: number[] = [];
		let endedAfter = -1;
		startSession(
			(x) => seen.push(x),
			() => {
				endedAfter = seen.length;
			}
		);

		// Two moves inside one frame: the rAF is armed once and has not run.
		document.dispatchEvent(pointer('pointermove', 1, { clientX: 5, clientY: 0 }));
		document.dispatchEvent(pointer('pointermove', 1, { clientX: 9, clientY: 0 }));
		expect(seen).toEqual([]);

		// Release before the frame: the latest position is flushed, then onEnd.
		document.dispatchEvent(pointer('pointerup', 1, { clientX: 9, clientY: 0 }));
		expect(seen).toEqual([9]);
		expect(endedAfter).toBe(1);
	});

	it('does not replay a move the frame already processed', () => {
		const raf = stubRaf();
		const seen: number[] = [];
		startSession((x) => seen.push(x));

		document.dispatchEvent(pointer('pointermove', 1, { clientX: 7, clientY: 0 }));
		raf.runFrame();
		expect(seen).toEqual([7]);

		// A release with no new move must not re-process the settled one.
		document.dispatchEvent(pointer('pointerup', 1, { clientX: 7, clientY: 0 }));
		expect(seen).toEqual([7]);
	});
});
