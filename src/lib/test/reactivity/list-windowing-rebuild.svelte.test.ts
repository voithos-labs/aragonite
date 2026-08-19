// @vitest-environment jsdom
// The rebuild must follow a same-length PERMUTATION, not only a count change, or the
// per-index heights stay in the old order until the next count change then remaps the
// anchor off a stale id — a one-shot scroll jump.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { heightsOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

// Height BY ID, so a permutation the model tracks changes each index's offset — the
// observable that proves the rebuild followed the reorder.
const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40 };

describe('list-windowing structural rebuild', () => {
	it('rebuilds the model on a same-length reorder, not only on a count change', async () => {
		const children = $state([
			makePara('p0\n'),
			makePara('p1\n'),
			makePara('p2\n'),
			makePara('p3\n')
		]);
		const ids = $state(['b0', 'b1', 'b2', 'b3']);
		const { windowing, cleanup, port } = mountListWindowing({
			children,
			ids,
			oracle: heightsOracle(HEIGHTS),
			listHeight: 200
		});

		// Move b3 (height 40) to the front — same length, so a count-keyed rebuild
		// never fires and the model keeps the old-order offsets.
		children.splice(0, children.length, children[3], children[0], children[1], children[2]);
		ids.splice(0, ids.length, 'b3', 'b0', 'b1', 'b2');
		flushSync();

		// revealChild scrolls to model.offsetOf(index). After the reorder the first two
		// blocks are b3(40)+b0(10)=50; a stale (un-rebuilt) model reads b0(10)+b1(20)=30.
		await windowing.revealChild(2);
		expect(port.scrollTop()).toBe(50);
		cleanup();
	});
});
