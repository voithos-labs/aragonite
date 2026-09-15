// @vitest-environment jsdom
// Miss-analysis: the flip's drop was pinned from the oracle's side (the cache empties) and from
// the resize side (a block that moves re-measures), but nothing ever rebuilt a model after it,
// which is the only moment the cache is read again, so the models silently outliving their
// backing had no test at any layer.
import { describe, it, expect } from 'vitest';
import { flushSync, tick } from 'svelte';
import { createHeightOracle } from '../../cursor/height-oracle';
import { HEIGHT_ESTIMATES } from '../../cursor/typography-estimates';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCKS = 10;
/** Well clear of the one-line prose estimate, so a reseeded slot is unmistakable. */
const MEASURED = 100;
const ANCHOR = 5;

function proseOracle() {
	return createHeightOracle({
		lineHeight: HEIGHT_ESTIMATES.proseLineHeight,
		codeLineHeight: HEIGHT_ESTIMATES.codeLineHeight,
		avgCharWidth: HEIGHT_ESTIMATES.avgCharWidth,
		blockChrome: HEIGHT_ESTIMATES.blockChrome,
		imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
	});
}

describe('a structural rebuild after the oracle dropped its cache', () => {
	it('keeps every surviving block at the height the model measured', async () => {
		const oracle = proseOracle();
		const children = $state(Array.from({ length: BLOCKS }, (_, i) => makePara(`p${i}\n`)));
		const ids = $state(Array.from({ length: BLOCKS }, (_, i) => `b${i}`));
		const { windowing, port, cleanup } = mountListWindowing({
			children,
			ids,
			oracle,
			listHeight: BLOCKS * MEASURED,
			viewportHeight: 300
		});

		for (const [i, id] of ids.entries()) {
			windowing.registerChild(id, {
				readHeight: () => MEASURED,
				applyHeight: (h) => windowing.recordMeasuredChild(i, id, h)
			});
		}
		await tick();
		await windowing.revealChild(ANCHOR);
		const parked = port.scrollTop();
		expect(parked, 'parked on measured heights').toBe(ANCHOR * MEASURED);

		// The flip: the cache goes, every model keeps the heights it took from it, and a block
		// whose box did not move reports no resize to put them back.
		oracle.dropMeasured();

		// Any structural edit rebuilds the model off the now-empty cache.
		children.push(makePara(`p${BLOCKS}\n`));
		ids.push(`b${BLOCKS}`);
		flushSync();

		expect(port.scrollTop(), 'the rebuild moved nobody').toBe(parked);
		cleanup();
	});
});
