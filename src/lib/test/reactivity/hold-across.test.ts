import { describe, it, expect } from 'vitest';
import { HeightModel } from '../../cursor/height-model';
import {
	focusedIndexIn,
	heldBlock,
	heldIndexIn,
	type HeightTable,
	type HeldBlock,
	type HeldDelta
} from '../../reactivity/hold-across';
import type { ListScrollWrites } from '../../reactivity/list-windowing.svelte';

// Six 100px blocks in the list at path [2], so a focus path outside it is expressible.
const LIST_PATH = [2];
const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const tableOf = (ids: string[], heightOf: (id: string) => number = () => 100): HeightTable => ({
	model: new HeightModel(ids.map(heightOf)),
	ids
});

const INSIDE = 250; // the viewport's top inside block c
const PAST_END = 700;

interface Row {
	name: string;
	localTop: number;
	focus: number[] | null;
	held: string | null;
}

const caseOf = (
	name: string,
	localTop: number,
	focus: number[] | null,
	held: string | null
): Row => ({
	name,
	localTop,
	focus,
	held
});

// Nothing in the list sits above a viewport top at 0, and nothing below one past the end.
const ROWS: Row[] = [
	caseOf('top inside, focused below the top', INSIDE, [2, 4], 'e'),
	caseOf('top inside, focused at the top', INSIDE, [2, 2], 'c'),
	caseOf('top inside, focused above the top', INSIDE, [2, 0], 'c'),
	caseOf('top inside, focus outside this list', INSIDE, [3, 4], 'c'),
	caseOf('top inside, no focus', INSIDE, null, 'c'),
	caseOf('top inside, focus path past the table', INSIDE, [2, 9], 'c'),
	caseOf('lst 0, focused below the top', 0, [2, 4], 'e'),
	caseOf('lst 0, focused at the top', 0, [2, 0], 'a'),
	caseOf('lst 0, focus outside this list', 0, [3, 4], null),
	caseOf('lst 0, no focus', 0, null, null),
	caseOf('past the end, focused on its last block', PAST_END, [2, 5], null),
	caseOf('past the end, focused above the top', PAST_END, [2, 1], null),
	caseOf('past the end, focus outside this list', PAST_END, [3, 4], null),
	caseOf('past the end, no focus', PAST_END, null, null)
];

function pickFor(row: Row, table: HeightTable) {
	return heldBlock(table, row.localTop, focusedIndexIn(row.focus, LIST_PATH));
}

describe('heldBlock', () => {
	for (const row of ROWS) {
		it(`${row.name}: holds ${row.held ?? 'nothing'}`, () => {
			expect(pickFor(row, tableOf(IDS))?.id ?? null).toBe(row.held);
		});
	}

	it('an empty list holds nothing', () => {
		expect(heldBlock(tableOf([]), INSIDE, 0)).toBeNull();
	});

	it('marks the caret’s block, so a change that moves it can cancel the hold', () => {
		const table = tableOf(IDS);
		expect(heldBlock(table, INSIDE, 4)?.focused).toBe(true);
		expect(heldBlock(table, INSIDE, 0)?.focused).toBe(false);
	});
});

describe('heldIndexIn', () => {
	const before = tableOf(IDS);
	const top = () => heldBlock(before, INSIDE, null)!;
	const caretOn = (index: number) => heldBlock(before, INSIDE, index)!;

	it('a measure keeps the table, so the index stands without a lookup', () => {
		expect(heldIndexIn(top(), before, before)).toBe(2);
	});

	it('finds the block by id after an insert before it', () => {
		expect(heldIndexIn(top(), before, tableOf(['n', ...IDS]))).toBe(3);
	});

	it('reads a removed block as gone', () => {
		expect(heldIndexIn(top(), before, tableOf(IDS.filter((id) => id !== 'c')))).toBe(-1);
	});

	// A reorder's block moves on a still page, so a caret's block the change moved past a
	// neighbour isn't held; an added or removed neighbour doesn't count.
	it.each([
		['moved up past d', ['a', 'b', 'c', 'e', 'd', 'f'], -1],
		['moved down past f', ['a', 'b', 'c', 'd', 'f', 'e'], -1],
		['d moved from before it to the end', ['a', 'b', 'c', 'e', 'f', 'd'], -1],
		['f moved from after it to the front', ['f', 'a', 'b', 'c', 'd', 'e'], -1],
		['a moved from above it to the end', ['b', 'c', 'd', 'e', 'f', 'a'], 3],
		['d deleted and n inserted next to it', ['a', 'b', 'c', 'n', 'e', 'f'], 4]
	] as const)('the caret’s block e, %s: %s', (_label, after, index) => {
		expect(heldIndexIn(caretOn(4), before, tableOf([...after]))).toBe(index);
	});

	it('the block at the top keeps its hold through a reorder that moves it', () => {
		expect(heldIndexIn(top(), before, tableOf(['a', 'b', 'd', 'c', 'e', 'f']))).toBe(3);
	});
});

describe('focusedIndexIn', () => {
	it('names the index at this list’s depth only when the path runs through the list', () => {
		expect(focusedIndexIn([2, 4, 1], [2])).toBe(4);
		expect(focusedIndexIn([4], [])).toBe(4);
		expect(focusedIndexIn([3, 4], [2])).toBeNull();
		expect(focusedIndexIn([2], [2])).toBeNull();
		expect(focusedIndexIn(null, [])).toBeNull();
	});
});

describe('a correction holds only what heldBlock picks', () => {
	it('refuses a hand-written distance, a scroll write from a list, or a hand-picked block', () => {
		const table = tableOf(IDS);
		const writes: ListScrollWrites = {
			beginRound: () => {},
			roundOpen: () => false,
			measureSoon: () => {},
			scrollToMount: () => {}
		};
		// @ts-expect-error a list writes heights, never a distance to scroll by
		writes.compensate?.(() => {}, 0);
		// @ts-expect-error a list mounts a block by its path, never by a scroll position
		writes.scrollToMount(120);
		// @ts-expect-error a block picked by hand isn't one `heldBlock` picked
		const byHand: HeldBlock = { id: 'c', index: 2, focused: false };
		expect(heldIndexIn(byHand, table, table)).toBe(2);
		// @ts-expect-error a distance worked out by hand isn't one `heldDelta` made
		const distance: HeldDelta = 40;
		expect(distance).toBe(40);
	});
});
