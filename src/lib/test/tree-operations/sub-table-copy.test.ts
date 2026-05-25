import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { copyRectangleAsSubTable } from '../../tree-operations/sub-table-copy';

const SOURCE = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

function parseTable() {
	return parse(SOURCE).children[0];
}

describe('copyRectangleAsSubTable', () => {
	it('emits header + delimiter + body for a 2x2 from top-left', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 0 }, { rowIdx: 1, colIdx: 1 });
		expect(out).toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
	});

	it('emits header + delimiter only for a single header row selection', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 0 }, { rowIdx: 0, colIdx: 2 });
		expect(out).toBe('| A | B | C |\n| :--- | :---: | ---: |\n');
	});

	it('promotes the first body row to header for a body-only rectangle', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 1, colIdx: 0 }, { rowIdx: 2, colIdx: 1 });
		expect(out).toBe('| 1 | 2 |\n| :--- | :---: |\n| 4 | 5 |\n');
	});

	it('returns the cell raw verbatim for a 1x1 selection', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 1, colIdx: 1 }, { rowIdx: 1, colIdx: 1 });
		expect(out).toBe('2');
	});

	it('slices alignments to the selected columns', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 1 }, { rowIdx: 1, colIdx: 2 });
		expect(out).toBe('| B | C |\n| :---: | ---: |\n| 2 | 3 |\n');
	});

	it('normalizes reversed corners', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 1, colIdx: 1 }, { rowIdx: 0, colIdx: 0 });
		expect(out).toBe('| A | B |\n| :--- | :---: |\n| 1 | 2 |\n');
	});

	it('emits the whole table when the rectangle spans every cell', () => {
		const table = parseTable();
		const out = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 0 }, { rowIdx: 2, colIdx: 2 });
		expect(out).toBe('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n');
	});

	it('preserves escaped pipes in cell raws', () => {
		const table = parse('| a | b \\| c |\n| --- | --- |\n| x | y |\n').children[0];
		const out = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 0 }, { rowIdx: 1, colIdx: 1 });
		expect(out).toBe('| a | b \\| c |\n| --- | --- |\n| x | y |\n');
	});
});
