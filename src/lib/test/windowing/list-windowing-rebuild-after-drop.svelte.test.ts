// @vitest-environment jsdom
// Miss-analysis: no test rebuilt a height table after the mode switch emptied the cache.
import { describe, it, expect } from 'vitest';
import { flushSync, tick } from 'svelte';
import { createLayoutState } from '../../windowing/layout-state.svelte';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCKS = 10;
/** Well clear of the one-line prose estimate, so an entry back on an estimate is obvious. */
const MEASURED = 100;
const ANCHOR = 5;

describe('a structural rebuild after the check dropped its cache', () => {
	it('keeps every surviving block at the height the model measured', async () => {
		const layout = createLayoutState();
		const oracle = layout.heightOracle;
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
				index: i,
				readHeight: () => MEASURED
			});
		}
		await tick();
		await windowing.revealChild(ANCHOR);
		const parked = port.scrollTop();
		expect(parked, 'the scroll rests on measured heights').toBe(ANCHOR * MEASURED);

		// The mode switch: the cache goes, every height table keeps the heights it took from it,
		// and a block whose box did not move reports no resize to put them back.
		layout.forgetMeasuredHeights();

		// Any structural edit rebuilds the height table off the now-empty cache.
		children.push(makePara(`p${BLOCKS}\n`));
		ids.push(`b${BLOCKS}`);
		flushSync();

		expect(port.scrollTop(), 'the rebuild moved nobody').toBe(parked);
		cleanup();
	});
});
