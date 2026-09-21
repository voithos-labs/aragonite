// @vitest-environment jsdom
// Miss-analysis: every suite here drove a stub scroll container that stored a fractional
// `scrollTop` as given, so the one thing a real scroller does to a correction, round the write
// and report the rounded value back as the base for the next one, was untested at any level.
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCKS = 20;
const TALL = 100;
/** A shrink whose fraction no whole-pixel scroller can hold, as when a fence loses its
 *  markers. */
const SHORT = 55.34;
const SHRUNK = 10;
const ANCHOR = 12;

describe('the anchor correction over a scroller that snaps to whole pixels', () => {
	it('holds the anchor block through a run of fractional shrinks', async () => {
		const ids = Array.from({ length: BLOCKS }, (_, i) => `b${i}`);
		const { windowing, port, cleanup } = mountListWindowing({
			children: ids.map((_, i) => makePara(`p${i}\n`)),
			ids,
			oracle: fixedOracle(TALL),
			listHeight: BLOCKS * TALL,
			viewportHeight: 300,
			snapsToPixel: true
		});

		const heights = new Map(ids.map((id) => [id, TALL]));
		for (const [i, id] of ids.entries()) {
			windowing.registerChild(id, {
				readHeight: () => heights.get(id)!,
				applyHeight: (h) => windowing.recordMeasuredChild(i, id, h)
			});
		}
		await tick();

		// Put the held block exactly at the top of the viewport, then shrink everything above it.
		await windowing.revealChild(ANCHOR);
		for (const id of ids.slice(0, SHRUNK)) {
			heights.set(id, SHORT);
			windowing.measureChildOnResize(id, SHORT);
		}

		const settled = port.scrollTop();
		await windowing.revealChild(ANCHOR);
		expect(port.scrollTop(), 'the anchor is still at the viewport top').toBe(settled);
		cleanup();
	});
});
