// @vitest-environment jsdom
// Miss-analysis: the subtotal channel took its id from the list's own table, and the one test of it
// pinned that snapshot with a plain id array no real list has, so a measure landing at an index
// that another block now holds was never run.
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import { makePara, mountListWindowing } from '../harness/list-windowing.svelte';

const HEIGHT = 100;
const MEASURED = 250;

function recordingOracle(): HeightOracle & { recorded: [string, number][] } {
	const recorded: [string, number][] = [];
	return {
		recorded,
		estimate: () => HEIGHT,
		measured: () => undefined,
		recordMeasured: (id, h) => void recorded.push([id, h])
	};
}

async function measureAtSlotOne(id: string) {
	const oracle = recordingOracle();
	const scope = mountListWindowing({
		children: [makePara('p0\n'), makePara('p1\n'), makePara('p2\n')],
		ids: ['b0', 'b1', 'b2'],
		oracle,
		listHeight: 3 * HEIGHT
	});
	scope.windowing.registerChild(id, { index: 1, readHeight: () => MEASURED });
	await tick();
	const slotHeight = scope.windowing.targetTopOf(1)?.height;
	scope.cleanup();
	return { recorded: oracle.recorded, slotHeight };
}

describe('a measured height lands in its slot only while the slot holds that block', () => {
	it('a block measured at a slot another block now holds keeps its own height, not the slot', async () => {
		const { recorded, slotHeight } = await measureAtSlotOne('bMoved');
		expect(recorded).toEqual([['bMoved', MEASURED]]);
		expect(slotHeight).toBe(HEIGHT);
	});

	it('a block measured at its own slot writes the slot', async () => {
		const { recorded, slotHeight } = await measureAtSlotOne('b1');
		expect(recorded).toEqual([['b1', MEASURED]]);
		expect(slotHeight).toBe(MEASURED);
	});
});
