// Miss-analysis: a nested target was placed from DOM rects against the root table alone, so no
// test read a block's place, or the block a round holds, through every table on its path.
import { describe, it, expect } from 'vitest';
import { HeightModel } from '../../windowing/height-model';
import { createListTree, type ListLevel } from '../../windowing/list-tree';
import type { HeightTable } from '../../windowing/pinned-block';

const tableOf = (heights: Record<string, number>): HeightTable => ({
	model: new HeightModel(Object.values(heights)),
	ids: Object.keys(heights)
});

function levelOf(
	path: number[],
	table: HeightTable | (() => HeightTable),
	top: number | null,
	mounted: (index: number) => boolean = () => true
): ListLevel {
	const read = typeof table === 'function' ? table : () => table;
	return {
		path: () => path,
		built: read,
		current: read,
		top: () => top,
		contentTop: () => top,
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

describe('list tree: a round over one list', () => {
	// Six 100px blocks at the root; INSIDE puts the viewport's top 50px into c.
	const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
	const INSIDE = 250;
	const table = (ids: string[], height: (id: string) => number = () => 100): HeightTable => ({
		model: new HeightModel(ids.map(height)),
		ids
	});

	/** How far the held block moved once `change` has run; the level reads its last-built table
	 *  at the round's open and whatever `change` leaves at its close. */
	function movedAcross(
		scrollTop: number,
		focus: number[] | null,
		change: (state: { built: HeightTable; now: HeightTable }) => void
	): number | null {
		const state = { built: table(IDS), now: table(IDS) };
		state.now = state.built;
		const tree = createListTree({ getScrollTop: () => scrollTop, getFocusPath: () => focus });
		tree.add({
			path: () => [],
			built: () => state.built,
			current: () => state.now,
			top: () => 0,
			contentTop: () => 0,
			isInWindow: () => true
		});
		const read = tree.holdForRound();
		change(state);
		return read?.() ?? null;
	}
	const grow = ({ built }: { built: HeightTable }) => built.model.setHeight(0, 130);
	const insertBeforeD = (state: { now: HeightTable }) => {
		state.now = table(['a', 'b', 'c', 'n', 'd', 'e', 'f'], (id) => (id === 'n' ? 40 : 100));
	};
	const reorder = (ids: string[]) => (state: { now: HeightTable }) => {
		state.now = table(ids);
	};

	it.each([
		['the block at the top, a grown above it', INSIDE, null, grow, 30],
		['the caret’s block below the top, a grown above it', INSIDE, [4], grow, 30],
		['nothing at the list’s top edge', 0, null, grow, null],
		['the block at the top, a block inserted below it', INSIDE, null, insertBeforeD, 0],
		['the caret’s block, a block inserted above it', INSIDE, [4], insertBeforeD, 40],
		['the block at the top removed', INSIDE, null, reorder(['a', 'b', 'd', 'e', 'f']), 0],
		['the caret’s block removed: the top one holds', INSIDE, [4], reorder(['a', 'b', 'c', 'f']), 0],
		[
			'the caret’s block moved past d: the top one holds',
			INSIDE,
			[4],
			reorder(['a', 'b', 'c', 'e', 'd', 'f']),
			0
		],
		[
			'the caret’s block at the top moved down past d',
			INSIDE,
			[2],
			reorder(['a', 'b', 'd', 'c', 'e', 'f']),
			100
		],
		[
			'f moved from after the caret’s block to the front',
			INSIDE,
			[4],
			reorder(['f', 'a', 'b', 'c', 'd', 'e']),
			100
		]
	] as const)('%s: moves %s', (_label, scrollTop, focus, change, moves) => {
		expect(movedAcross(scrollTop, focus ? [...focus] : null, change)).toBe(moves);
	});
});

describe('list tree: one round over nested lists', () => {
	// Miss-analysis: every hold row read tables that stood still between the pick and the read, so
	// none showed one list's rebuild counted again by a round another list opened.
	it('counts a nested rebuild and the container’s own measure once', () => {
		const root = tableOf(ROOT);
		let inner = tableOf(INNER);
		const built = inner;
		const tree = createListTree({
			getScrollTop: () => 200 + CHROME + 150,
			getFocusPath: () => null
		});
		tree.add(levelOf([], root, 0));
		tree.add({ ...levelOf([2], inner, CHROME), built: () => built, current: () => inner });
		const moved = tree.holdForRound();
		// A 50px block goes in before n1, and the root measures b2 50px taller in the same round.
		inner = { model: new HeightModel([100, 50, 100, 100]), ids: ['n0', 'nx', 'n1', 'n2'] };
		root.model.setHeight(2, 350);
		expect(moved?.()).toBe(50);
	});

	it('counts a container’s chrome growing above the held block', () => {
		const root = tableOf(ROOT);
		const inner = tableOf(INNER);
		let chrome = CHROME;
		const tree = createListTree({
			getScrollTop: () => 200 + CHROME + 150,
			getFocusPath: () => null
		});
		tree.add(levelOf([], root, 0));
		tree.add({ ...levelOf([2], inner, CHROME), top: () => chrome });
		const moved = tree.holdForRound();
		chrome += 30;
		root.model.setHeight(2, 330);
		expect(moved?.()).toBe(30);
	});
});
