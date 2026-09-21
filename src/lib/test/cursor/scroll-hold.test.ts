// @vitest-environment jsdom

// Miss-analysis: this shipped as a scroll writer with no test at its own level, so the two
// rules that keep it out of the editor's way (do nothing while a scroll into view is running,
// write nothing when the position never moved) rode entirely on one e2e that exercises neither.

import { describe, it, expect, afterEach } from 'vitest';
import { captureScrollPosition } from '../../cursor/scroll-hold';

/** A scroll container jsdom can actually answer: the instance property shadows the accessor
 *  that needs layout, so both the position and the writes against it can be observed. */
function mountScroller(at: number) {
	const port = document.createElement('div');
	port.style.overflowY = 'auto';
	let scrollTop = at;
	let writes = 0;
	Object.defineProperty(port, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			writes++;
			scrollTop = value;
		}
	});
	const block = document.createElement('div');
	port.appendChild(block);
	document.body.appendChild(port);
	/** What the browser's maximum-scroll clamp does to the container mid-swap. */
	const clampTo = (value: number) => {
		scrollTop = value;
	};
	return { block, clampTo, writes: () => writes, scrollTop: () => scrollTop };
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('captureScrollPosition', () => {
	it('re-asserts a position the swap clamped away', async () => {
		const scroller = mountScroller(500);
		const restore = captureScrollPosition(scroller.block, () => false);

		scroller.clampTo(120);
		await restore();

		expect(scroller.scrollTop()).toBe(500);
	});

	it('does nothing while a reveal claim holds the viewport', async () => {
		const scroller = mountScroller(500);
		const restore = captureScrollPosition(scroller.block, () => true);

		scroller.clampTo(120);
		await restore();

		expect(scroller.scrollTop()).toBe(120);
		expect(scroller.writes()).toBe(0);
	});

	it('writes nothing when the swap moved the port not at all', async () => {
		const scroller = mountScroller(500);
		const restore = captureScrollPosition(scroller.block, () => false);

		await restore();

		expect(scroller.writes()).toBe(0);
	});

	it('is inert for a block with no element', async () => {
		await expect(captureScrollPosition(null, () => false)()).resolves.toBeUndefined();
	});
});
