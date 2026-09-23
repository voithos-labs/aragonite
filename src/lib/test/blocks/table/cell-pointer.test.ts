// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { takeDevWarns } from '../../support/warn-gate';
import {
	handleCellShiftClick,
	cellCoordsOfElement,
	mountedRowEls,
	rowCellEls,
	type CellAnchor
} from '../../../components/blocks/table/cell-pointer';
import { createSelectionState } from '../../../selection/selection-state.svelte';
import type { DocumentView } from '../../../core/node-views';

describe('handleCellShiftClick', () => {
	function makeAnchor(rowIdx: number, colIdx: number): CellAnchor {
		return {
			tableEl: document.createElement('div'),
			tablePath: [2],
			rowIdx,
			colIdx,
			columnCount: 3
		};
	}

	// The anchor carries cellCoordinate so a later extend out of the table snaps its whole row,
	// matching the drag anchor; the focus keeps the offset its context establishes.
	it('builds shallow-path multi-cell selection from cold state', () => {
		const sel = createSelectionState();
		handleCellShiftClick(sel, makeAnchor(0, 0), { rowIdx: 1, colIdx: 2 });
		expect(sel.anchor).toEqual({ path: [2], offset: 0, cellCoordinate: true });
		expect(sel.focus).toEqual({ path: [2], offset: 5 });
	});

	it('extends focus when already in custom-rendered mode', () => {
		const sel = createSelectionState();
		sel.enterCrossBlock({ path: [2], offset: 0, cellCoordinate: true }, { path: [2], offset: 1 });
		handleCellShiftClick(sel, makeAnchor(0, 0), { rowIdx: 2, colIdx: 2 });
		expect(sel.anchor).toEqual({ path: [2], offset: 0, cellCoordinate: true });
		expect(sel.focus).toEqual({ path: [2], offset: 8 });
	});

	it('encodes anchor at non-origin cell', () => {
		const sel = createSelectionState();
		handleCellShiftClick(sel, makeAnchor(1, 1), { rowIdx: 2, colIdx: 0 });
		expect(sel.anchor).toEqual({ path: [2], offset: 4, cellCoordinate: true });
		expect(sel.focus).toEqual({ path: [2], offset: 6 });
	});

	it('does not mutate the input tablePath', () => {
		const sel = createSelectionState();
		const anchor = makeAnchor(0, 0);
		handleCellShiftClick(sel, anchor, { rowIdx: 0, colIdx: 1 });
		anchor.tablePath[0] = 99;
		expect(sel.anchor!.path).toEqual([2]);
		expect(sel.focus!.path).toEqual([2]);
	});

	// Reading a rectangle inside one table, where the ends normalise and the snap is skipped,
	// must not fire the coordinate-space warning.
	it('reads the same-table rectangle without a coordinate-space warn', () => {
		const doc = {
			kind: 'document',
			prefix: '',
			suffix: '',
			children: [
				{
					kind: 'table',
					leadingTrivia: '',
					raw: '',
					metadata: { columnCount: 3, alignments: ['none', 'none', 'none'] },
					children: []
				}
			]
		} as unknown as DocumentView;
		const sel = createSelectionState({ getDoc: () => doc });
		handleCellShiftClick(sel, { ...makeAnchor(0, 0), tablePath: [0] }, { rowIdx: 1, colIdx: 2 });
		void sel.start;
		void sel.end;
		void sel.isCustomRendered;
		expect(takeDevWarns()).toEqual([]);
	});
});

// ── DOM-dependent helpers ─────────────────────────────────────────────────

describe('cellCoordsOfElement', () => {
	let tableEl: HTMLElement;

	beforeEach(() => {
		tableEl = document.createElement('div');
		tableEl.setAttribute('role', 'table');
		document.body.appendChild(tableEl);
		for (let r = 0; r < 2; r++) {
			const rowEl = document.createElement('div');
			rowEl.setAttribute('role', 'row');
			rowEl.setAttribute('data-table-row-idx', String(r));
			tableEl.appendChild(rowEl);
			for (let c = 0; c < 3; c++) {
				const cellEl = document.createElement('div');
				cellEl.setAttribute('role', r === 0 ? 'columnheader' : 'cell');
				rowEl.appendChild(cellEl);
			}
		}
	});

	afterEach(() => {
		tableEl.remove();
	});

	// Returning the resolved cell element is what lets `cellAtPoint` call through here
	// and still give back its `{ rowIdx, colIdx, cellEl }` shape.
	it('cellCoordsOfElement reads coords and the resolved cell from a cell descendant', () => {
		const cell = tableEl.querySelector('[data-table-row-idx="1"] > [role="cell"]:nth-child(2)');
		expect(cellCoordsOfElement(cell, tableEl)).toEqual({ rowIdx: 1, colIdx: 1, cellEl: cell });
	});

	it('cellCoordsOfElement resolves from a nested descendant, not just the cell itself', () => {
		const cell = tableEl.querySelector(
			'[data-table-row-idx="0"] > [role="columnheader"]:nth-child(3)'
		) as HTMLElement;
		const inner = document.createElement('span');
		cell.appendChild(inner);
		expect(cellCoordsOfElement(inner, tableEl)).toEqual({ rowIdx: 0, colIdx: 2, cellEl: cell });
	});

	it('cellCoordsOfElement returns null when element is outside the table', () => {
		const stranger = document.createElement('div');
		document.body.appendChild(stranger);
		expect(cellCoordsOfElement(stranger, tableEl)).toBeNull();
		stranger.remove();
	});

	it('cellCoordsOfElement returns null for a cell in a different table', () => {
		const otherTable = document.createElement('div');
		otherTable.setAttribute('role', 'table');
		const otherRow = document.createElement('div');
		otherRow.setAttribute('data-table-row-idx', '0');
		const otherCell = document.createElement('div');
		otherCell.setAttribute('role', 'cell');
		otherRow.appendChild(otherCell);
		otherTable.appendChild(otherRow);
		document.body.appendChild(otherTable);
		expect(cellCoordsOfElement(otherCell, tableEl)).toBeNull();
		otherTable.remove();
	});
});

// The one selector contract for the cell grid: rows by `data-table-row-idx`, cells by
// `role="cell"` or, in the header row, `role="columnheader"`, direct children only.
describe('mountedRowEls / rowCellEls', () => {
	let tableEl: HTMLElement;

	beforeEach(() => {
		tableEl = document.createElement('div');
		tableEl.setAttribute('role', 'table');
		// A spacer sits directly under the table but is not a row; the row selector must
		// skip it (mirrors the real grid's windowing spacers).
		tableEl.appendChild(document.createElement('span'));
		for (let r = 0; r < 3; r++) {
			const rowEl = document.createElement('div');
			rowEl.setAttribute('data-table-row-idx', String(r));
			tableEl.appendChild(rowEl);
			for (let c = 0; c < 2; c++) {
				const cellEl = document.createElement('div');
				cellEl.setAttribute('role', r === 0 ? 'columnheader' : 'cell');
				rowEl.appendChild(cellEl);
			}
		}
	});

	it('mountedRowEls returns the row elements in DOM order, skipping non-rows', () => {
		const rows = mountedRowEls(tableEl);
		expect(rows.map((r) => r.getAttribute('data-table-row-idx'))).toEqual(['0', '1', '2']);
	});

	it('rowCellEls returns a row’s direct cells in column order', () => {
		const row = mountedRowEls(tableEl)[1];
		expect(rowCellEls(row)).toHaveLength(2);
		expect(rowCellEls(row).every((c) => c.getAttribute('role') === 'cell')).toBe(true);
	});

	it('rowCellEls counts the header row’s column headers as its cells', () => {
		const header = mountedRowEls(tableEl)[0];
		expect(rowCellEls(header).map((c) => c.getAttribute('role'))).toEqual([
			'columnheader',
			'columnheader'
		]);
	});

	it('rowCellEls ignores a nested cell in a sub-table', () => {
		const row = mountedRowEls(tableEl)[0];
		// A cell that itself holds a nested table's cell must not be counted for the outer
		// row: `:scope >` keeps the search to the row's own column cells.
		const nested = document.createElement('div');
		nested.setAttribute('role', 'cell');
		row.firstChild!.appendChild(nested);
		expect(rowCellEls(row)).toHaveLength(2);
	});
});
