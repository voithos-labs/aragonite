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

	// Miss-analysis: the rebuild's correction had its own copy of the held-block pick, without the
	// focused block, and no rebuild test put a caret between the viewport's top and the edit.
	it('keeps the focused block still when a block between it and the viewport’s top is deleted', () => {
		const heights: Record<string, number> = { b0: 100, b1: 100, b2: 100, b3: 70, b4: 100, b5: 100 };
		const children = $state(Object.keys(heights).map((id) => makePara(`${id}\n`)));
		const ids = $state(Object.keys(heights));
		const { cleanup, port } = mountListWindowing({
			children,
			ids,
			oracle: heightsOracle(heights),
			listHeight: 570,
			// The caret is in b4, read where it is now, as the editor reads it off the block's element.
			getFocusPath: () => [ids.indexOf('b4')]
		});
		// The viewport's top is inside b1, and b4 sits 220px below it.
		port.setScrollTop(150);

		children.splice(3, 1);
		ids.splice(3, 1);
		flushSync();

		// b4 moved up by b3's 70px, and the scroll follows it rather than holding b1.
		expect(port.scrollTop()).toBe(80);
		cleanup();
	});
});
