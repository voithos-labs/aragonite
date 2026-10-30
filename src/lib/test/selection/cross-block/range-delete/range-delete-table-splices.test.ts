import { describe, it, expect } from 'vitest';
import { parse } from '../../../../core/parser';
import { cellPoint, type SelectionPoint } from '../../../../selection/primitives';
import { TWO_COL_FOUR_ROW, TWO_COL_THREE_ROW, findTable } from '../../table-fixtures';
import { deleteRange } from '../../../harness/range-delete';

function run(source: string, start: SelectionPoint, end: SelectionPoint) {
	const doc = parse(source);
	const result = deleteRange(doc, start, end);
	return { doc: result.newDoc, splices: result.tableRowSplices };
}

describe('rangeDelete: tableRowSplices reporting', () => {
	// The cross-block commit reports each endpoint table's structural change from these splices
	// (matched by node identity) instead of re-deriving the snap.
	it('Case 1 reports the end table row prefix it removed', () => {
		const { doc, splices } = run(
			`intro\n\n${TWO_COL_FOUR_ROW}`,
			{ path: [0], offset: 2 },
			cellPoint([1], 3)
		);

		const table = findTable(doc)!;
		expect(splices).toEqual([{ table, at: 0, count: 2 }]);
	});

	it('Case 2 reports the start table row suffix it removed', () => {
		const { doc, splices } = run(`${TWO_COL_FOUR_ROW}\nafter\n`, cellPoint([0], 2), {
			path: [1],
			offset: 0
		});

		const table = findTable(doc)!;
		expect(splices).toEqual([{ table, at: 1, count: 3 }]);
	});

	it('two-table span reports one splice per table', () => {
		const { doc, splices } = run(
			`${TWO_COL_THREE_ROW}\n${TWO_COL_THREE_ROW}`,
			cellPoint([0], 3),
			cellPoint([1], 2)
		);

		const [startTable, endTable] = doc.children;
		// Each side takes whole rows: the start's row and those below, the end's row and those above.
		expect(splices).toEqual([
			{ table: startTable, at: 1, count: 2 },
			{ table: endTable, at: 0, count: 2 }
		]);
	});
});
