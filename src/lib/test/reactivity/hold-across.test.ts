import { describe, it, expect } from 'vitest';
import { HeightModel } from '../../cursor/height-model';
import {
	focusedIndexIn,
	heldBlock,
	holdAcross,
	type HeightTable
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

/** How far each held block moves when block a grows 30px, when a 40px block goes in before d,
 *  and when the held block itself is removed (a removed caret's block leaves the top one held). */
const MOVES: Record<string, [grown: number, inserted: number, removed: number]> = {
	a: [0, 0, 0],
	c: [30, 0, 0],
	e: [30, 40, 0],
	nothing: [0, 0, 0]
};

/** The focus path as the editor reads it after the change: the focused block where it is now,
 *  or nothing when the change removed it. A path outside this list or past it passes unchanged. */
function onScreen(focus: number[] | null, before: HeightTable, after: HeightTable) {
	const index = focusedIndexIn(focus, LIST_PATH);
	if (index === null || index >= before.ids.length) return index;
	const now = after.ids.indexOf(before.ids[index]);
	return now === -1 ? null : now;
}

function pickFor(row: Row, before: HeightTable, after = before) {
	return heldBlock(before, after, row.localTop, onScreen(row.focus, before, after));
}

describe('heldBlock', () => {
	for (const row of ROWS) {
		it(`${row.name}: holds ${row.held ?? 'nothing'}`, () => {
			expect(pickFor(row, tableOf(IDS))?.id ?? null).toBe(row.held);
		});
	}

	it('an empty list holds nothing', () => {
		const empty = tableOf([]);
		expect(heldBlock(empty, empty, INSIDE, 0)).toBeNull();
	});
});

describe('holdAcross', () => {
	for (const row of ROWS) {
		const [grown, inserted, removed] = MOVES[row.held ?? 'nothing'];

		it(`${row.name}, block a grown in place: moves ${grown}`, () => {
			const table = tableOf(IDS);
			const held = pickFor(row, table);
			const grow = () => table.model.setHeight(0, 130);
			expect(holdAcross(table, () => table, held, grow)).toBe(grown);
		});

		it(`${row.name}, a block inserted before d: moves ${inserted}`, () => {
			const before = tableOf(IDS);
			const after = tableOf(['a', 'b', 'c', 'n', 'd', 'e', 'f'], (id) => (id === 'n' ? 40 : 100));
			expect(
				holdAcross(
					before,
					() => after,
					pickFor(row, before, after),
					() => {}
				)
			).toBe(inserted);
		});

		it(`${row.name}, the held block removed: moves ${removed}`, () => {
			const before = tableOf(IDS);
			const gone = row.held ?? 'c';
			const after = tableOf(IDS.filter((id) => id !== gone));
			expect(
				holdAcross(
					before,
					() => after,
					pickFor(row, before, after),
					() => {}
				)
			).toBe(removed);
		});
	}

	it('runs the change once, and reads the table after it', () => {
		const before = tableOf(IDS);
		let after = before;
		let runs = 0;
		const held = heldBlock(before, before, INSIDE, null);
		const delta = holdAcross(
			before,
			() => after,
			held,
			() => {
				runs++;
				after = tableOf(['n', ...IDS]);
			}
		);
		expect({ runs, delta }).toEqual({ runs: 1, delta: 100 });
	});
});

// A reorder's block moves on a still page, so a focused block the change moved past a neighbour
// isn't held; the rule falls back to the block at the top.
const MOVED: {
	name: string;
	localTop: number;
	focus: number[];
	after: string[];
	held: string | null;
	moves: number;
}[] = [
	{
		name: 'focused e moved up past d',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['a', 'b', 'c', 'e', 'd', 'f'],
		held: 'c',
		moves: 0
	},
	{
		name: 'focused e moved down past f',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['a', 'b', 'c', 'd', 'f', 'e'],
		held: 'c',
		moves: 0
	},
	{
		name: 'focused c, at the top, moved down past d',
		localTop: INSIDE,
		focus: [2, 2],
		after: ['a', 'b', 'd', 'c', 'e', 'f'],
		held: 'c',
		moves: 100
	},
	{
		name: 'focused d, at the top, moved up past c',
		localTop: 350,
		focus: [2, 3],
		after: ['a', 'b', 'd', 'c', 'e', 'f'],
		held: 'd',
		moves: -100
	},
	{
		name: 'lst 0, focused e moved up past d',
		localTop: 0,
		focus: [2, 4],
		after: ['a', 'b', 'c', 'e', 'd', 'f'],
		held: null,
		moves: 0
	},
	{
		name: 'focused e, a moved from above it to the end',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['b', 'c', 'd', 'e', 'f', 'a'],
		held: 'e',
		moves: -100
	},
	{
		name: 'focused e, d deleted and n inserted next to it',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['a', 'b', 'c', 'n', 'e', 'f'],
		held: 'e',
		moves: 0
	},
	// Only one neighbour changes in each of these two, so each half of the check has its own row.
	{
		name: 'focused e, d moved from before it to the end',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['a', 'b', 'c', 'e', 'f', 'd'],
		held: 'c',
		moves: 0
	},
	{
		name: 'focused e, f moved from after it to the front',
		localTop: INSIDE,
		focus: [2, 4],
		after: ['f', 'a', 'b', 'c', 'd', 'e'],
		held: 'c',
		moves: 100
	}
];

describe('a focused block the change moved', () => {
	for (const row of MOVED) {
		it(`${row.name}: holds ${row.held ?? 'nothing'}, which moves ${row.moves}`, () => {
			const before = tableOf(IDS);
			const after = tableOf(row.after);
			const held = heldBlock(before, after, row.localTop, onScreen(row.focus, before, after));
			expect(held?.id ?? null).toBe(row.held);
			expect(
				holdAcross(
					before,
					() => after,
					held,
					() => {}
				)
			).toBe(row.moves);
		});
	}
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

describe('a list correction holds only what heldBlock picks', () => {
	it('refuses a hand-written distance or a hand-picked block', () => {
		const table = tableOf(IDS);
		const writes: ListScrollWrites = { compensate: () => {}, scrollToMount: () => {} };
		writes.compensate(
			() => {},
			// @ts-expect-error a distance worked out by hand isn't one `holdAcross` measured
			(run) => {
				run();
				return 0;
			}
		);
		// @ts-expect-error a block picked by hand isn't one `heldBlock` picked
		const byHand: Parameters<typeof holdAcross>[2] = { id: 'c', index: 2 };
		expect(
			holdAcross(
				table,
				() => table,
				byHand,
				() => {}
			)
		).toBe(0);
	});
});
