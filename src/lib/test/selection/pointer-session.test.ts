// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createPointerDragSession } from '../../selection/pointer-session';

// The release contract every drag inherits: the release resolves the drag at its own point before
// any other listener hears it, and no point the drag already resolved is processed twice.

function pointer(
	type: string,
	pointerId: number,
	coords?: { clientX: number; clientY: number }
): PointerEvent {
	const event = new MouseEvent(type, coords) as MouseEvent & { pointerId: number };
	Object.defineProperty(event, 'pointerId', { value: pointerId });
	return event as unknown as PointerEvent;
}

describe('createPointerDragSession: move coalescing', () => {
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

	function startSession(onMove: (x: number) => void, onEnd?: () => void): { dispose(): void } {
		return createPointerDragSession(pointer('pointerdown', 1, { clientX: 0, clientY: 0 }), {
			touch: 'browser',
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

		// Two moves inside one frame: one frame callback is pending and has not run.
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

	// Miss-analysis (#748): every row released at a point a move had already reported.
	it('resolves at the release point when no move reported it', () => {
		const raf = stubRaf();
		const seen: number[] = [];
		startSession((x) => seen.push(x));

		document.dispatchEvent(pointer('pointermove', 1, { clientX: 4, clientY: 0 }));
		raf.runFrame();
		// A move and release in one frame can arrive release first.
		document.dispatchEvent(pointer('pointerup', 1, { clientX: 12, clientY: 0 }));
		expect(seen).toEqual([4, 12]);
	});

	it('resolves the release before a document-level capture listener hears it', () => {
		stubRaf();
		const order: string[] = [];
		const session = startSession(() => order.push('move'));
		// The selection toolbar's phase: what it renders on release must not be what the drag hits.
		const chrome = () => order.push('chrome');
		document.addEventListener('pointerup', chrome, true);
		try {
			document.dispatchEvent(pointer('pointermove', 1, { clientX: 6, clientY: 0 }));
			document.dispatchEvent(pointer('pointerup', 1, { clientX: 6, clientY: 0 }));
			expect(order).toEqual(['move', 'chrome']);
		} finally {
			document.removeEventListener('pointerup', chrome, true);
			session.dispose();
		}
	});

	it('runs nothing extra on a release that never moved', () => {
		stubRaf();
		const seen: number[] = [];
		startSession((x) => seen.push(x));
		document.dispatchEvent(pointer('pointerup', 1, { clientX: 3, clientY: 0 }));
		expect(seen).toEqual([]);
	});

	it('flushes only the pending move on cancel, never the cancel point', () => {
		stubRaf();
		const seen: number[] = [];
		startSession((x) => seen.push(x));
		document.dispatchEvent(pointer('pointermove', 1, { clientX: 8, clientY: 0 }));
		document.dispatchEvent(pointer('pointercancel', 1, { clientX: 0, clientY: 0 }));
		expect(seen).toEqual([8]);
	});
});

describe('createPointerDragSession: who drags for a finger', () => {
	function fingerDown(): PointerEvent {
		const down = pointer('pointerdown', 1, { clientX: 0, clientY: 0 });
		Object.defineProperty(down, 'pointerType', { value: 'touch' });
		return down;
	}

	for (const [touch, expected] of [
		['own', [9]],
		['browser', []]
	] as const) {
		it(`a session the ${touch === 'own' ? 'control' : 'browser'} owns for a finger resolves ${expected.length ? 'its moves' : 'nothing'}`, () => {
			const seen: number[] = [];
			const session = createPointerDragSession(fingerDown(), {
				touch,
				onMove: (p) => seen.push(p.clientX),
				autoScroll: { getTargets: () => [] }
			});
			document.dispatchEvent(pointer('pointermove', 1, { clientX: 9, clientY: 0 }));
			document.dispatchEvent(pointer('pointerup', 1, { clientX: 9, clientY: 0 }));
			session.dispose();
			expect(seen).toEqual(expected);
		});
	}
});
