import { describe, it, expect } from 'vitest';
import { CURSOR_START } from '#lib/block-component.js';
import { makeTableMutations } from './table-mutations-harness';

// a11y: an alignment choice must put the caret back in the originating cell and announce via
// the live region, rather than dropping keyboard focus to <body> silently.

const TABLE = '| a | b |\n| --- | --- |\n| c | d |\n';

const mutationsFor = (focusedCell: { rowIdx: number; colIdx: number } | null) =>
	makeTableMutations(TABLE, { focusedCell, rowIds: ['row-0', 'row-1'] });

describe('setColumnAlignment: caret landing + announcement', () => {
	it('lands in the originating cell in the aligned column and announces', async () => {
		const { mutations, landings, announceEdit } = mutationsFor({ rowIdx: 1, colIdx: 1 });

		await mutations.setColumnAlignment(1, 'center');

		expect(landings).toEqual([{ leafPath: [0, 1, 1], offset: CURSOR_START, outcome: 'placed' }]);
		expect(announceEdit).toHaveBeenCalledWith('Column aligned center');
	});

	it('falls back to row 0 of the aligned column when no cell is focused (menu-driven)', async () => {
		const { mutations, landings, announceEdit } = mutationsFor(null);

		await mutations.setColumnAlignment(0, 'right');

		expect(landings).toEqual([{ leafPath: [0, 0, 0], offset: CURSOR_START, outcome: 'placed' }]);
		expect(announceEdit).toHaveBeenCalledWith('Column aligned right');
	});
});
