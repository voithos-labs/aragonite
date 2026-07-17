// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../../dev-warn';
import {
	handleCellShiftClick,
	cellCoordsOfElement,
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

	// The anchor carries cellCoordinate so a later exit-the-table extend snaps its
	// whole row (matching the drag anchor); the focus stays context-established.
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

	// Reverted-incident guard: reading a same-table rectangle (start/end normalize +
	// snap short-circuit) must not trip the coordinate-space warn that force-flagging
	// every same-table read once caused.
	it('reads the same-table rectangle without a coordinate-space warn', () => {
		vi.mocked(devWarn).mockClear();
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
		expect(devWarn).not.toHaveBeenCalled();
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
				cellEl.setAttribute('role', 'cell');
				rowEl.appendChild(cellEl);
			}
		}
	});

	afterEach(() => {
		tableEl.remove();
	});

	it('cellCoordsOfElement reads coords from a cell descendant', () => {
		const cell = tableEl.querySelector('[data-table-row-idx="1"] > [role="cell"]:nth-child(2)');
		expect(cellCoordsOfElement(cell, tableEl)).toEqual({ rowIdx: 1, colIdx: 1 });
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
