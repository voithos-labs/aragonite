// @vitest-environment jsdom
// Miss-analysis: the resize gate's only test was its pure predicate, and the harness oracle
// answers `measured()` with undefined for every id, so no mounted scope ever saw a block resize
// after `dropMeasured()`, which is what a presentation-mode flip does to every mounted block.
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { createHeightOracle } from '../../cursor/height-oracle';
import { HEIGHT_ESTIMATES } from '../../cursor/typography-estimates';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const MEASURED = 100;
const RESIZED = 140;

describe('a resize after the oracle dropped its cache', () => {
	it('still re-measures the block into the model', async () => {
		const oracle = createHeightOracle({
			lineHeight: HEIGHT_ESTIMATES.proseLineHeight,
			codeLineHeight: HEIGHT_ESTIMATES.codeLineHeight,
			avgCharWidth: HEIGHT_ESTIMATES.avgCharWidth,
			blockChrome: HEIGHT_ESTIMATES.blockChrome,
			imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
		});
		const { windowing, cleanup, port } = mountListWindowing({
			children: [makePara('p0\n'), makePara('p1\n')],
			ids: ['b0', 'b1'],
			oracle,
			listHeight: 2 * MEASURED
		});

		let height = MEASURED;
		windowing.registerChild('b0', {
			readHeight: () => height,
			applyHeight: (h) => windowing.recordMeasuredChild(0, 'b0', h)
		});
		// A scroll, so the batch has read the block whichever trigger it keys on.
		await windowing.revealChild(1);
		await tick();
		expect(oracle.measured('b0')).toBe(MEASURED);

		// The flip: every measured height goes, and the mounted block's box then moves with the
		// markers that stopped painting. The observer reports it; the model must follow.
		oracle.dropMeasured();
		height = RESIZED;
		windowing.measureChildOnResize('b0', RESIZED);

		await windowing.revealChild(1);
		expect(port.scrollTop()).toBe(RESIZED);
		cleanup();
	});
});
