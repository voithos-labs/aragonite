// @vitest-environment jsdom
// The model rebuild must follow a same-length PERMUTATION (a reorder), not only a
// count change: otherwise `modelChildIds` and the per-index heights stay in the old
// order until the next count-change rebuild, which then remaps the anchor off a
// stale id (a one-shot scroll jump).
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { createListWindowing, type ListWindowing } from '../../reactivity/list-windowing.svelte';
import type { HeightOracle } from '../../cursor/height-oracle';
import type { CstNode } from '../../core/nodes';

// Height BY ID, so a permutation the model tracks changes each index's offset — the
// observable that proves the rebuild followed the reorder.
const HEIGHTS: Record<string, number> = { b0: 10, b1: 20, b2: 30, b3: 40 };

const oracle: HeightOracle = {
	estimate: () => 10,
	measured: () => undefined,
	recordMeasured: () => {},
	height: (id: string) => HEIGHTS[id] ?? 10,
	invalidateWidth: () => {},
	clear: () => {}
};

function stubEl(height: number) {
	return {
		scrollTop: 0,
		clientHeight: height,
		clientWidth: 800,
		getBoundingClientRect: () => ({ top: 0, height }),
		addEventListener: () => {},
		removeEventListener: () => {}
	} as unknown as HTMLElement;
}

const makePara = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });

describe('list-windowing structural rebuild', () => {
	it('rebuilds the model on a same-length reorder, not only on a count change', async () => {
		const children = $state([
			makePara('p0\n'),
			makePara('p1\n'),
			makePara('p2\n'),
			makePara('p3\n')
		]);
		const ids = $state(['b0', 'b1', 'b2', 'b3']);
		const scrollEl = stubEl(500);
		const listEl = stubEl(200);

		let windowing!: ListWindowing;
		const cleanup = $effect.root(() => {
			windowing = createListWindowing({
				oracle,
				getChildren: () => children,
				getChildIds: () => ids,
				getListEl: () => listEl,
				getScrollEl: () => scrollEl,
				getFocusPath: () => null,
				getWidthVersion: () => 0,
				getParentPath: () => [],
				overscan: 2,
				pinExtensionCap: 100,
				activateAbovePx: 1000,
				deactivateBelowPx: 800
			});
		});
		flushSync();

		// Move b3 (height 40) to the front — same length, so a count-keyed rebuild
		// never fires and the model keeps the old-order offsets.
		children.splice(0, children.length, children[3], children[0], children[1], children[2]);
		ids.splice(0, ids.length, 'b3', 'b0', 'b1', 'b2');
		flushSync();

		// revealChild scrolls to model.offsetOf(index). After the reorder the first two
		// blocks are b3(40)+b0(10)=50; a stale (un-rebuilt) model reads b0(10)+b1(20)=30.
		await windowing.revealChild(2);
		expect(scrollEl.scrollTop).toBe(50);
		cleanup();
	});
});
