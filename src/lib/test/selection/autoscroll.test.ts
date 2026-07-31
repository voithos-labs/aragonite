// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAutoScroll } from '../../selection/autoscroll';

// A target whose scroll position is fixed (already at its limit): writes are
// accepted but never change the reported offset. `scrolls` targets move freely.
function makeTarget(rect: Partial<DOMRect>, scrolls: boolean): HTMLElement {
	let left = 0;
	let top = 0;
	return {
		getBoundingClientRect: () => rect as DOMRect,
		get scrollLeft() {
			return left;
		},
		set scrollLeft(v: number) {
			if (scrolls) left = v;
		},
		get scrollTop() {
			return top;
		},
		set scrollTop(v: number) {
			if (scrolls) top = v;
		}
	} as unknown as HTMLElement;
}

const RECT = { left: 0, right: 100, top: 0, bottom: 100 } as Partial<DOMRect>;

describe('createAutoScroll — rAF loop termination at scroll limits (E-F7)', () => {
	let queue: FrameRequestCallback[];
	let rafCalls: number;
	let originalRaf: typeof requestAnimationFrame;
	let originalCancel: typeof cancelAnimationFrame;

	beforeEach(() => {
		queue = [];
		rafCalls = 0;
		originalRaf = globalThis.requestAnimationFrame;
		originalCancel = globalThis.cancelAnimationFrame;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCalls++;
			queue.push(cb);
			return rafCalls;
		}) as typeof requestAnimationFrame;
		globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;
	});

	afterEach(() => {
		globalThis.requestAnimationFrame = originalRaf;
		globalThis.cancelAnimationFrame = originalCancel;
	});

	function drainOneFrame(): void {
		const cb = queue.shift();
		if (cb) cb(0);
	}

	it('stops the loop when the target is pinned at its scroll limit', () => {
		// Pointer in the right edge band (95 > right(100) - threshold(30)).
		const target = makeTarget(RECT, false);
		const autoScroll = createAutoScroll({
			getPointer: () => ({ clientX: 95, clientY: 50 }),
			getTargets: () => [target]
		});

		autoScroll.maybeStart();
		expect(rafCalls).toBe(1);
		drainOneFrame();
		// The clamped target never moved, so the frame must not reschedule.
		expect(rafCalls).toBe(1);
	});

	it('keeps looping while a target actually scrolls', () => {
		const target = makeTarget(RECT, true);
		const autoScroll = createAutoScroll({
			getPointer: () => ({ clientX: 95, clientY: 50 }),
			getTargets: () => [target]
		});

		autoScroll.maybeStart();
		expect(rafCalls).toBe(1);
		drainOneFrame();
		// A real scroll reschedules the next frame.
		expect(rafCalls).toBe(2);
		autoScroll.dispose();
	});

	// The window target answers its two halves from different places — the split that left a
	// page-scrolled embedding with no autoscroll at all.
	describe('the window target', () => {
		const VIEWPORT_HEIGHT = 700;
		let written: number;

		// jsdom lays nothing out and leaves `scrollingElement` null, so the viewport and the document
		// box both have to be stated. The gap between them is the point.
		beforeEach(() => {
			written = 0;
			const doc = document.documentElement;
			Object.defineProperty(doc, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true });
			Object.defineProperty(doc, 'clientWidth', { value: 1024, configurable: true });
			doc.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: 5000 }) as DOMRect;
			Object.defineProperty(doc, 'scrollTop', {
				get: () => written,
				set: (v: number) => (written = v),
				configurable: true
			});
			Object.defineProperty(document, 'scrollingElement', { value: doc, configurable: true });
		});

		afterEach(() => {
			const doc = document.documentElement as unknown as Record<string, unknown>;
			for (const prop of ['clientHeight', 'clientWidth', 'getBoundingClientRect', 'scrollTop']) {
				delete doc[prop];
			}
			delete (document as unknown as Record<string, unknown>).scrollingElement;
		});

		it('measures the viewport, not the document box, and writes the scrolling element', () => {
			const autoScroll = createAutoScroll({
				getPointer: () => ({ clientX: 500, clientY: VIEWPORT_HEIGHT - 5 }),
				getTargets: () => [window]
			});

			// The pointer sits in the VIEWPORT's bottom edge band, nowhere near the document box's, so
			// measuring `document.scrollingElement`'s rect — the obvious substitution — never starts it.
			autoScroll.maybeStart();
			expect(rafCalls).toBe(1);
			drainOneFrame();
			expect(written).toBeGreaterThan(0);
			autoScroll.dispose();
		});
	});
});
