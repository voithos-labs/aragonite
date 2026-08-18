import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { createSharingState } from '../../tree-operations/sharing';
import type { SelectionPoint } from '../../selection/primitives';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { TWO_COL_THREE_ROW } from './table-fixtures';

// rangeDelete is driven with hand-built endpoints, so the table arms see char offsets
// SelectionState would have snapped to cell coordinates.
afterEach(() => allowDevWarns(['deleteAcrossTwoTables:start', 'deleteAcrossTwoTables:end']));

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const result = rangeDelete(
		parse(source),
		start,
		end,
		createSharingState(),
		undefined,
		undefined,
		undefined
	);
	return { doc: result.newDoc, caret: result.collapsedCaret };
}

describe('rangeDelete — across two top-level tables (char-addressable caret)', () => {
	it('both tables survive: caret lands in the start table anchor cell with a char offset', () => {
		// Tables A=[0], B=[1], 6 cells each. Anchor cell 3 of A (row 1, col 1), focus inclusive cell 2
		// of B: A's cell (1,1) clears and its last body row drops; B's header row drops.
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [0], offset: 3 },
			{ path: [1], offset: 2 }
		);

		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('table');
		expect(doc.children[1].kind).toBe('table');
		// Anchor cell 3 = row 1, col 1 of the (still [0]) start table; it was
		// cleared, so a char offset of 0 into a real cell leaf.
		expect(caret).toEqual({ path: [0, 1, 1], offset: 0 });
	});

	it('start empties, end survives: caret lands in the first surviving cell of the end table', () => {
		// Anchor cell 0 of A clears all of A → A removed. B shifts to [0]; its
		// header row (cells 0,1,2 cleared by inclusive focus offset 2) drops, body promotes.
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 2 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('table');
		// End table is now [0]; first surviving cell (0,0), char offset 0.
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
	});

	it('start survives, end empties: caret lands in the start table anchor cell', () => {
		// Anchor cell 3 of A clears A's tail; A survives at [0]. Focus inclusive cell 5
		// (last cell) clears B entirely → B removed.
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [0], offset: 3 },
			{ path: [1], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('table');
		expect(caret).toEqual({ path: [0, 1, 1], offset: 0 });
	});

	it('both empty with surrounding paragraphs: caret lands at the end of the preceding paragraph', () => {
		// Doc: pre[0], A[1], B[2], post[3]. Both tables clear and are removed; the anchor-side
		// convention puts the caret at the end of the nearest surviving block before the range.
		const { doc, caret } = run(
			`pre\n\n${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}\npost\n`,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 5 }
		);

		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('paragraph');
		// "pre" raw is "pre\n" → displayLength 3. Caret at end of "pre".
		expect(caret).toEqual({ path: [0], offset: 3 });
	});

	it('both empty with a preceding table: caret deep-addresses the last cell of the survivor', () => {
		// Tables [0], [1], [2]. Selecting all of [1] and [2] removes both; the caret must address [0]'s
		// last cell as a char-offset leaf, never the table block shallowly.
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('table');
		// Last cell of the survivor: row 2 ('| 3 | 4 |'), col 1, raw '4' → offset 1.
		expect(caret).toEqual({ path: [0, 2, 1], offset: 1 });
	});

	it('both empty with a preceding blockquote: caret descends to the survivor last leaf', () => {
		// Blockquote (two paragraphs) [0], tables [1] and [2]. The caret must land at the END of the
		// blockquote's deepest leaf: a char offset on the container path names bytes no leaf owns.
		const { doc, caret } = run(
			`> alpha\n>\n> bravo\n\n${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('blockquote');
		// Deepest last leaf: the "bravo" paragraph at [0, 1]; raw "bravo\n" → offset 5.
		expect(caret).toEqual({ path: [0, 1], offset: 5 });
	});

	it('both empty with a blockquote ending in a fenced code block: caret descends to the code leaf', () => {
		// The blockquote's deepest leaf is a fenced code block — editable but NOT merge-eligible — so
		// the survivor caret must descend by focusability rather than merge-eligibility.
		const { doc, caret } = run(
			'> alpha\n>\n> ```\n> code\n> ```\n\n' + `${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('blockquote');
		// Deepest last leaf: the fenced code block at [0, 1]; its raw is
		// "```\ncode\n```\n" → displayLength 12.
		expect(caret).toEqual({ path: [0, 1], offset: 12 });
	});

	it('both empty with a preceding list: caret descends into the last item last leaf', () => {
		// List (two items) [0], tables [1] and [2]. Both consumed, so the caret lands on the last
		// item's leaf, deep-pathed, not at a shallow offset on the list's container path.
		const { doc, caret } = run(
			`- one\n- two\n\n${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [1], offset: 0 },
			{ path: [2], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('list');
		// list[0] → last item [1] → its paragraph leaf [0]; raw "two\n" → offset 3.
		expect(caret).toEqual({ path: [0, 1, 0], offset: 3 });
	});

	it('start empties across an intervening blockquote: end-table path is not over-shifted', () => {
		// Table A [0], blockquote [1], table B [2]. A empties → removed; the blockquote AND its inner
		// paragraph are both deletion paths, and counting the nested one would over-shift B's index.
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n> quoted\n\n${TWO_COL_THREE_ROW}`,
			{ path: [0], offset: 0 },
			{ path: [2], offset: 2 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('table');
		expect(caret).toEqual({ path: [0, 0, 0], offset: 0 });
	});

	it('both empty with no surrounding blocks: caret lands in a materialized empty paragraph', () => {
		// Doc is only the two tables; clearing both empties the document. Mirror
		// the prose precedent: materialize one empty paragraph at [0].
		const { doc, caret } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			{ path: [0], offset: 0 },
			{ path: [1], offset: 5 }
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(caret).toEqual({ path: [0], offset: 0 });
	});
});
