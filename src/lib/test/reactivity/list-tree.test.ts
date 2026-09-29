// Miss-analysis: a nested target was placed from DOM rects against the root table alone, so no
// test read a block's place, or the block a round holds, through every table on its path.
import { describe, it, expect } from 'vitest';
import { HeightModel } from '../../cursor/height-model';
import { createListTree, type ListLevel } from '../../reactivity/list-tree';
import type { HeightTable } from '../../reactivity/hold-across';

const tableOf = (heights: Record<string, number>): HeightTable => ({
	model: new HeightModel(Object.values(heights)),
	ids: Object.keys(heights)
});

function levelOf(
	path: number[],
	table: HeightTable,
	top: number | null,
	mounted: (index: number) => boolean = () => true
): ListLevel {
	return {
		path: () => path,
		settled: () => table,
		current: () => table,
		top: () => top,
		isInWindow: mounted
	};
}

// The root holds b0@0 b1@100 b2@200 (a container, 300 tall) b3@500. b2's list starts 20px into
// its box and holds n0@0 n1@100 n2@200.
const ROOT = { b0: 100, b1: 100, b2: 300, b3: 100 };
const INNER = { n0: 100, n1: 100, n2: 100 };
const CHROME = 20;

function treeWith(opts: { scrollTop?: number; focus?: number[] | null; inner?: ListLevel | null }) {
	const root = tableOf(ROOT);
	const inner = tableOf(INNER);
	const tree = createListTree({
		getScrollTop: () => opts.scrollTop ?? 0,
		getFocusPath: () => opts.focus ?? null
	});
	tree.add(levelOf([], root, 0));
	const nested = opts.inner === undefined ? levelOf([2], inner, CHROME) : opts.inner;
	if (nested) tree.add(nested);
	return { tree, root, inner };
}

describe('list tree: where a block sits', () => {
	it('reads a top-level block off the root table', () => {
		expect(treeWith({}).tree.resolve([3])).toEqual({ top: 500, height: 100 });
	});

	it('adds a mounted container’s own offset and its list’s', () => {
		expect(treeWith({}).tree.resolve([2, 1])).toEqual({ top: 200 + CHROME + 100, height: 100 });
	});

	it('falls back to the container while it is unmounted', () => {
		expect(treeWith({ inner: null }).tree.resolve([2, 1])).toEqual({ top: 200, height: 300 });
	});

	// Answering the container's top for a block it windowed out would re-place a different block.
	it('declines when a mounted container has windowed the block out', () => {
		const inner = levelOf([2], tableOf(INNER), CHROME, (index) => index !== 1);
		expect(treeWith({ inner }).tree.resolve([2, 1])).toBeNull();
	});
});

describe('list tree: the block a round holds', () => {
	/** How far the held block moved once `change` has run. */
	function movedAfter(
		opts: Parameters<typeof treeWith>[0],
		change: (t: ReturnType<typeof treeWith>) => void
	) {
		const t = treeWith(opts);
		const moved = t.tree.holdForRound();
		change(t);
		return moved?.() ?? null;
	}
	const growN0 = ({ root, inner }: ReturnType<typeof treeWith>) => {
		inner.model.setHeight(0, 150);
		root.model.setHeight(2, 350);
	};

	it('descends to the innermost block at the viewport’s top, so one growth counts once', () => {
		// The top sits inside n1: the root's move of b2 is 0, the inner list's of n1 is 50.
		expect(movedAfter({ scrollTop: 200 + CHROME + 150 }, growN0)).toBe(50);
	});

	it('holds a focused block below the container at the root, once', () => {
		expect(movedAfter({ scrollTop: 200 + CHROME + 150, focus: [3] }, growN0)).toBe(50);
	});

	it('stops at the container when the top sits in its chrome above the list', () => {
		expect(movedAfter({ scrollTop: 205 }, growN0)).toBe(0);
	});

	it('holds nothing past the root table’s end', () => {
		expect(movedAfter({ scrollTop: 900 }, growN0)).toBeNull();
	});
});
