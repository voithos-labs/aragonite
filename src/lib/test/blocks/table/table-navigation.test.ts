import { describe, it, expect } from 'vitest';
import {
	nextCell,
	prevCell,
	cellAbove,
	cellBelow,
	type CellCoord
} from '../../../components/blocks/table/table-navigation';

describe('table-navigation: nextCell', () => {
	it('moves to the next column within the row', () => {
		expect(nextCell({ rowIdx: 0, colIdx: 0 }, 3, 3)).toEqual<CellCoord>({ rowIdx: 0, colIdx: 1 });
	});
	it('wraps to the first column of the next row', () => {
		expect(nextCell({ rowIdx: 0, colIdx: 2 }, 3, 3)).toEqual<CellCoord>({ rowIdx: 1, colIdx: 0 });
	});
	it('answers null at the last cell of the last row', () => {
		expect(nextCell({ rowIdx: 2, colIdx: 2 }, 3, 3)).toBeNull();
	});
});

describe('table-navigation: prevCell', () => {
	it('moves to the previous column within the row', () => {
		expect(prevCell({ rowIdx: 0, colIdx: 1 }, 3)).toEqual<CellCoord>({ rowIdx: 0, colIdx: 0 });
	});
	it('wraps to the last column of the previous row', () => {
		expect(prevCell({ rowIdx: 1, colIdx: 0 }, 3)).toEqual<CellCoord>({ rowIdx: 0, colIdx: 2 });
	});
	it('answers null at the first cell of the first row', () => {
		expect(prevCell({ rowIdx: 0, colIdx: 0 }, 3)).toBeNull();
	});
});

describe('table-navigation: cellAbove / cellBelow', () => {
	it('moves directly above in same column', () => {
		expect(cellAbove({ rowIdx: 1, colIdx: 1 })).toEqual<CellCoord>({ rowIdx: 0, colIdx: 1 });
	});
	it('answers null from the top row', () => {
		expect(cellAbove({ rowIdx: 0, colIdx: 1 })).toBeNull();
	});
	it('moves directly below in same column', () => {
		expect(cellBelow({ rowIdx: 1, colIdx: 1 }, 3)).toEqual<CellCoord>({ rowIdx: 2, colIdx: 1 });
	});
	it('answers null from the bottom row', () => {
		expect(cellBelow({ rowIdx: 2, colIdx: 1 }, 3)).toBeNull();
	});
});
