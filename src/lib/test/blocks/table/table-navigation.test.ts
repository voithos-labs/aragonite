import { describe, it, expect } from 'vitest';
import {
	nextCell,
	prevCell,
	cellAbove,
	cellBelow,
	type CellMove
} from '../../../components/blocks/table/table-navigation';

describe('table-navigation: nextCell', () => {
	it('moves to the next column within the row', () => {
		expect(nextCell({ rowIdx: 0, colIdx: 0 }, 3, 3)).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 0,
			colIdx: 1
		});
	});
	it('wraps to the first column of the next row', () => {
		expect(nextCell({ rowIdx: 0, colIdx: 2 }, 3, 3)).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 1,
			colIdx: 0
		});
	});
	it('signals create-new-row at the last cell of the last row', () => {
		expect(nextCell({ rowIdx: 2, colIdx: 2 }, 3, 3)).toEqual<CellMove>({ kind: 'create-row' });
	});
});

describe('table-navigation: prevCell', () => {
	it('moves to the previous column within the row', () => {
		expect(prevCell({ rowIdx: 0, colIdx: 1 }, 3)).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 0,
			colIdx: 0
		});
	});
	it('wraps to the last column of the previous row', () => {
		expect(prevCell({ rowIdx: 1, colIdx: 0 }, 3)).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 0,
			colIdx: 2
		});
	});
	it('signals exit-up at the first cell of the first row', () => {
		expect(prevCell({ rowIdx: 0, colIdx: 0 }, 3)).toEqual<CellMove>({ kind: 'exit-up' });
	});
});

describe('table-navigation: cellAbove / cellBelow', () => {
	it('moves directly above in same column', () => {
		expect(cellAbove({ rowIdx: 1, colIdx: 1 })).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 0,
			colIdx: 1
		});
	});
	it('signals exit-up from the top row', () => {
		expect(cellAbove({ rowIdx: 0, colIdx: 1 })).toEqual<CellMove>({ kind: 'exit-up' });
	});
	it('moves directly below in same column', () => {
		expect(cellBelow({ rowIdx: 1, colIdx: 1 }, 3)).toEqual<CellMove>({
			kind: 'cell',
			rowIdx: 2,
			colIdx: 1
		});
	});
	it('signals exit-down from the bottom row', () => {
		expect(cellBelow({ rowIdx: 2, colIdx: 1 }, 3)).toEqual<CellMove>({
			kind: 'exit-down'
		});
	});
});
