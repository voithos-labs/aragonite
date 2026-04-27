import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow,
	deleteColumn,
	cycleAlignment
} from '../../../components/blocks/table/table-mutations';
import type { TableMetadata, TableRowMetadata } from '../../../core/nodes';

function parseTable(src: string) {
	return parse(src).children[0];
}

describe('insertEmptyRow', () => {
	it('inserts an empty row above the target index', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		insertEmptyRow(table, 1, 'above');
		expect(table.children).toHaveLength(3);
		const inserted = table.children![1];
		expect(inserted.kind).toBe('tableRow');
		expect((inserted.metadata as TableRowMetadata).isHeader).toBe(false);
		expect(inserted.children!.map((c) => c.raw)).toEqual(['', '']);
	});

	it('inserts an empty row below the target index', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		insertEmptyRow(table, 1, 'below');
		expect(table.children).toHaveLength(3);
		expect(table.children![2].children!.map((c) => c.raw)).toEqual(['', '']);
	});

	it('keeps the existing header at row 1 when inserting above row 0', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		insertEmptyRow(table, 0, 'above');
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(false);
		expect((table.children![1].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![1].children!.map((c) => c.raw)).toEqual(['A', 'B']);
	});

	it('appends as the last row when inserting below the last index', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		insertEmptyRow(table, 2, 'below');
		expect(table.children).toHaveLength(4);
		expect(table.children![3].children!.map((c) => c.raw)).toEqual(['', '']);
	});
});

describe('deleteRow', () => {
	it('removes a body row and leaves the header intact', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		const ok = deleteRow(table, 1);
		expect(ok).toBe(true);
		expect(table.children).toHaveLength(2);
		expect(table.children![1].children![0].raw).toBe('3');
	});

	it('promotes the next row to header when row 0 is removed', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		deleteRow(table, 0);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['1', '2']);
	});

	it('returns false when only one body row remains', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const ok = deleteRow(table, 1);
		expect(ok).toBe(false);
		expect(table.children).toHaveLength(2);
	});

	it('returns false when the table is header-only', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n');
		const ok = deleteRow(table, 0);
		expect(ok).toBe(false);
	});
});

describe('insertEmptyColumn', () => {
	it('inserts a column to the left and pads alignments with none', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		insertEmptyColumn(table, 1, 'left');
		expect((table.metadata as TableMetadata).columnCount).toBe(3);
		expect((table.metadata as TableMetadata).alignments).toEqual(['none', 'none', 'none']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', '', 'B']);
		expect(table.children![1].children!.map((c) => c.raw)).toEqual(['1', '', '2']);
	});

	it('inserts a column to the right and preserves existing alignments around the gap', () => {
		const table = parseTable('| A | B |\n| :--- | ---: |\n| 1 | 2 |\n');
		insertEmptyColumn(table, 1, 'right');
		expect((table.metadata as TableMetadata).alignments).toEqual(['left', 'right', 'none']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', 'B', '']);
	});
});

describe('deleteColumn', () => {
	it('removes the column from every row and trims its alignment', () => {
		const table = parseTable('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n');
		const ok = deleteColumn(table, 1);
		expect(ok).toBe(true);
		expect((table.metadata as TableMetadata).columnCount).toBe(2);
		expect((table.metadata as TableMetadata).alignments).toEqual(['left', 'right']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', 'C']);
	});

	it('returns false when only one column remains', () => {
		const table = parseTable('| A |\n| --- |\n| 1 |\n');
		const ok = deleteColumn(table, 0);
		expect(ok).toBe(false);
	});
});

describe('cycleAlignment', () => {
	it('cycles none → left → center → right → none', () => {
		const table = parseTable('| A |\n| --- |\n| 1 |\n');
		cycleAlignment(table, 0);
		expect((table.metadata as TableMetadata).alignments).toEqual(['left']);
		cycleAlignment(table, 0);
		expect((table.metadata as TableMetadata).alignments).toEqual(['center']);
		cycleAlignment(table, 0);
		expect((table.metadata as TableMetadata).alignments).toEqual(['right']);
		cycleAlignment(table, 0);
		expect((table.metadata as TableMetadata).alignments).toEqual(['none']);
	});

	it('advances from a non-none starting alignment without resetting', () => {
		const table = parseTable('| A |\n| :--- |\n| 1 |\n');
		expect((table.metadata as TableMetadata).alignments).toEqual(['left']);
		cycleAlignment(table, 0);
		expect((table.metadata as TableMetadata).alignments).toEqual(['center']);
	});
});
