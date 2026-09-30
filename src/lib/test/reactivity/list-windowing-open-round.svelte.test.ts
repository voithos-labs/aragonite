// @vitest-environment jsdom
// Miss-analysis: every window row read a table and a scroll that matched, so none saw a rebuild
// unmount the block at the top in the flush before its correction, remounting it from estimates.
import { describe, it, expect } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCKS = 60;
const IDS = Array.from({ length: BLOCKS }, (_, i) => `b${i}`);

/** Every block `height.px` tall, estimated fresh on each table build. */
function sizedOracle(height: { px: number }): HeightOracle {
	return {
		estimate: () => height.px,
		measured: () => undefined,
		recordMeasured: () => {}
	};
}

describe('a list while a round is open', () => {
	it('keeps the blocks it had mounted until the correction lands', async () => {
		const height = { px: 100 };
		let widthVersion = $state(0);
		const { windowing, port, cleanup } = mountListWindowing({
			children: IDS.map((id) => makePara(`${id}\n`)),
			ids: IDS,
			oracle: sizedOracle(height),
			listHeight: BLOCKS * 100,
			getWidthVersion: () => widthVersion
		});
		// b20 sits at the viewport's top.
		port.setScrollTop(2000);
		windowing.syncScrollTop();
		flushSync();
		const before = windowing.window;
		expect(before.start).toBeLessThanOrEqual(20);

		// A narrower width re-estimates every block shorter; at the same scroll the table would put
		// b24 at the top, and a range from that alone would drop the blocks around b20.
		height.px = 90;
		widthVersion++;
		flushSync();
		expect(windowing.window.start, 'b20 stays mounted until the round closes').toBe(before.start);

		await tick();
		// The round kept b20 still: 20 blocks of 90px above it.
		expect(port.scrollTop()).toBe(1800);
		cleanup();
	});
});
