import { describe, it, expect } from 'vitest';
import { makeTableMutations } from './table-mutations-harness';

// a11y: an alignment choice must refocus the originating cell and announce via the live
// region, rather than dropping keyboard focus to <body> silently.

const TABLE = '| a | b |\n| --- | --- |\n| c | d |\n';

const mutationsFor = (focusedCell: { rowIdx: number; colIdx: number } | null) =>
	makeTableMutations(TABLE, { focusedCell, rowIds: ['row-0', 'row-1'] });

describe('setColumnAlignment — focus restore + announcement', () => {
	it('refocuses the originating cell in the aligned column and announces', async () => {
		const { mutations, focusCell, announceReorder } = mutationsFor({ rowIdx: 1, colIdx: 1 });

		await mutations.setColumnAlignment(1, 'center');

		expect(focusCell).toHaveBeenCalledWith(1, 1, 'start');
		expect(announceReorder).toHaveBeenCalledWith('Column aligned center');
	});

	it('falls back to row 0 of the aligned column when no cell is focused (menu-driven)', async () => {
		const { mutations, focusCell, announceReorder } = mutationsFor(null);

		await mutations.setColumnAlignment(0, 'right');

		expect(focusCell).toHaveBeenCalledWith(0, 0, 'start');
		expect(announceReorder).toHaveBeenCalledWith('Column aligned right');
	});
});
