// @vitest-environment jsdom
// The rebuild has to follow a reorder that keeps the same length, not only a change in count,
// or the heights stay in the old order until the next count change and then look the held block
// up by a stale id, which jumps the scroll once.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { heightsOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';

// Heights are keyed by id, so a reorder the height table follows changes every index's
// offset, which is what proves the rebuild followed the reorder.
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

		// Move b3 (height 40) to the front. The length is unchanged, so a rebuild keyed on the
		// count never fires and the height table keeps the old order's offsets.
		children.splice(0, children.length, children[3], children[0], children[1], children[2]);
		ids.splice(0, ids.length, 'b3', 'b0', 'b1', 'b2');
		flushSync();

		// `revealChild` scrolls to `model.offsetOf(index)`. After the reorder the first two blocks
		// are b3(40) + b0(10) = 50; a table that never rebuilt reads b0(10) + b1(20) = 30.
		await windowing.revealChild(2);
		expect(port.scrollTop()).toBe(50);
		cleanup();
	});
});
