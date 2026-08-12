import { describe, it, expect, afterEach } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { createSharingState } from '../../tree-operations/sharing';
import type { CstNode, Document } from '../../core/nodes';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// rangeDelete is driven with hand-built endpoints, so the table arms see char offsets
// SelectionState would have snapped to cell coordinates first.
afterEach(() =>
	expectDevWarns([
		'deleteFromProseIntoTable:end',
		'deleteFromTableIntoProse:start',
		'deleteAcrossTwoTables:start',
		'deleteAcrossTwoTables:end'
	])
);

function findTable(doc: Document): CstNode | null {
	for (const child of doc.children) {
		if (child.kind === 'table') return child;
	}
	return null;
}

const TWO_COL_FOUR_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';
const TWO_COL_THREE_ROW = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

describe('rangeDelete — tableRowSplices reporting', () => {
	// The cross-block commit maps each endpoint table's scope descriptor from
	// these splices (by node identity) instead of re-deriving snap math.
	it('Case 1 reports the end table row prefix it removed', () => {
		const doc = parse(`intro\n\n${TWO_COL_FOUR_ROW}`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [1], offset: 3 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = findTable(result.newDoc)!;
		expect(result.tableRowSplices).toEqual([{ table, at: 0, count: 2 }]);
	});

	it('Case 2 reports the start table row suffix it removed', () => {
		const doc = parse(`${TWO_COL_FOUR_ROW}\nafter\n`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [1], offset: 0 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = findTable(result.newDoc)!;
		expect(result.tableRowSplices).toEqual([{ table, at: 1, count: 3 }]);
	});

	it('two-table span reports one splice per table', () => {
		const doc = parse(`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 3 },
			{ path: [1], offset: 2 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const [startTable, endTable] = result.newDoc.children;
		expect(result.tableRowSplices).toEqual([
			{ table: startTable, at: 2, count: 1 },
			{ table: endTable, at: 0, count: 1 }
		]);
	});

	it('partial-row coverage that removes no rows reports no splice', () => {
		// End at cell 0: only half the header row is covered, so no whole row
		// is removed and no splice may be reported.
		const doc = parse(`intro\n\n${TWO_COL_FOUR_ROW}`);

		const result = rangeDelete(
			doc,
			{ path: [0], offset: 2 },
			{ path: [1], offset: 0 },
			createSharingState(),
			undefined,
			undefined,
			undefined
		);

		const table = findTable(result.newDoc)!;
		expect(table.children).toHaveLength(4);
		expect(result.tableRowSplices).toEqual([]);
	});
});
