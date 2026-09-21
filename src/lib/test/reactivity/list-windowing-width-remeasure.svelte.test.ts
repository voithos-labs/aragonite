// @vitest-environment jsdom
// Miss-analysis: the width path was tested only by the narrowing case in the anchoring suite,
// where the two corrections happen to pick the same block and cancel out; no case made the
// half-estimated table in between name a different block at the top of the viewport.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { Scrollport } from '../../cursor/scrollport';
import type { ListWindowing } from '../../reactivity/list-windowing.svelte';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const BLOCKS = 20;
const ESTIMATE = 100;
const REAL = 300;
/** Measured before the width change: everything the user already scrolled through. */
const SCROLLED_THROUGH = 12;
/** Mounted at the width change, so only these re-measure afterwards. */
const MOUNTED = [10, 11, 12, 13, 14];

const idOf = (i: number) => `b${i}`;

function seededOracle(): HeightOracle {
	const measured = new Map<string, number>();
	for (let i = 0; i < SCROLLED_THROUGH; i++) measured.set(idOf(i), REAL);
	return {
		estimate: () => ESTIMATE,
		measured: (id) => measured.get(id),
		recordMeasured: (id, height) => {
			measured.set(id, height);
		},
		dropMeasured: () => measured.clear()
	};
}

describe('list-windowing width re-measure', () => {
	it('holds the anchor block on screen across a width change (#188)', async () => {
		const oracle = seededOracle();
		let widthVersion = $state(0);
		const { windowing, cleanup, port } = mountListWindowing({
			children: Array.from({ length: BLOCKS }, (_, i) => makePara(`p${i}\n`)),
			ids: Array.from({ length: BLOCKS }, (_, i) => idOf(i)),
			oracle,
			listHeight: BLOCKS * REAL,
			getWidthVersion: () => widthVersion
		});

		// The mounted band reads its real height, which the estimates the width rebuild starts from
		// do not know: the error the correction must not absorb.
		for (const i of MOUNTED) {
			windowing.registerChild(idOf(i), {
				readHeight: () => REAL,
				applyHeight: (h) => windowing.recordMeasuredChild(i, idOf(i), h)
			});
		}

		// Put block 11 100px above the top of the viewport: its position on screen is what must hold.
		const anchor = 11;
		port.setScrollTop(SCROLLED_THROUGH * REAL - REAL + 100);
		const heldOffset = await screenOffsetOf(windowing, port, anchor);

		oracle.dropMeasured();
		widthVersion++;
		flushSync();

		expect(await screenOffsetOf(windowing, port, anchor)).toBe(heldOffset);
		cleanup();
	});
});

/** The held block's top relative to the top of the viewport. `revealChild` is the only read of
 *  `model.offsetOf` on offer, so it doubles as the measurement and is undone afterwards. */
async function screenOffsetOf(
	windowing: ListWindowing,
	port: Scrollport,
	index: number
): Promise<number> {
	const scrollTop = port.scrollTop();
	await windowing.revealChild(index);
	const offset = port.scrollTop() - scrollTop;
	port.setScrollTop(scrollTop);
	return offset;
}
