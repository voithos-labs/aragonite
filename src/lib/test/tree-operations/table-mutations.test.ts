import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import {
	insertEmptyRow,
	insertEmptyColumn,
	deleteRow,
	deleteColumn,
	moveColumn,
	cycleAlignment,
	setAlignment
} from '../../tree-operations/table-mutations';
import type { CstNode, TableMetadata, TableRowMetadata } from '../../core/nodes';

function parseTable(src: string) {
	return parse(src).children[0];
}

const meta = (t: CstNode) => t.metadata as TableMetadata;

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
		deleteRow(table, 1);
		expect(table.children).toHaveLength(2);
		expect(table.children![1].children![0].raw).toBe('3');
	});

	it('promotes the next row to header when row 0 is removed', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
		deleteRow(table, 0);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['1', '2']);
	});
});

describe('insertEmptyColumn', () => {
	it('inserts a column to the left and pads alignments with none', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const changes = insertEmptyColumn(table, 1, 'left');
		expect(meta(table).columnCount).toBe(3);
		expect(meta(table).alignments).toEqual(['none', 'none', 'none']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', '', 'B']);
		expect(table.children![1].children!.map((c) => c.raw)).toEqual(['1', '', '2']);
		expect(changes).toEqual(table.children!.map(() => ({ op: 'insert', at: 1, count: 1 })));
	});

	it('inserts a column to the right and preserves existing alignments around the gap', () => {
		const table = parseTable('| A | B |\n| :--- | ---: |\n| 1 | 2 |\n');
		const changes = insertEmptyColumn(table, 1, 'right');
		expect(meta(table).alignments).toEqual(['left', 'right', 'none']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', 'B', '']);
		expect(changes).toEqual(table.children!.map(() => ({ op: 'insert', at: 2, count: 1 })));
	});
});

describe('deleteColumn', () => {
	it('removes the column from every row and trims its alignment', () => {
		const table = parseTable('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n');
		const changes = deleteColumn(table, 1);
		expect(meta(table).columnCount).toBe(2);
		expect(meta(table).alignments).toEqual(['left', 'right']);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', 'C']);
		expect(changes).toEqual(table.children!.map(() => ({ op: 'delete', at: 1, count: 1 })));
	});
});

describe('moveColumn', () => {
	it('permutes cells in every row and the alignments array, preserving columnCount', () => {
		const table = parseTable('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n');
		const changes = moveColumn(table, 0, 2);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['B', 'C', 'A']);
		expect(table.children![1].children!.map((c) => c.raw)).toEqual(['2', '3', '1']);
		expect(meta(table).alignments).toEqual(['center', 'right', 'left']);
		expect(meta(table).columnCount).toBe(3);
		expect(changes).toHaveLength(2);
		expect(changes.every((c) => c.op === 'replace')).toBe(true);
	});

	it('is a noop per row when from === to', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const changes = moveColumn(table, 1, 1);
		expect(changes.every((c) => c.op === 'noop')).toBe(true);
		expect(table.children![0].children!.map((c) => c.raw)).toEqual(['A', 'B']);
	});
});

describe('cycleAlignment', () => {
	it('skips the visual no-op from none, then cycles left → center → right → left', () => {
		const table = parseTable('| A |\n| --- |\n| 1 |\n');
		cycleAlignment(table, 0);
		expect(meta(table).alignments).toEqual(['center']);
		cycleAlignment(table, 0);
		expect(meta(table).alignments).toEqual(['right']);
		cycleAlignment(table, 0);
		expect(meta(table).alignments).toEqual(['left']);
		cycleAlignment(table, 0);
		expect(meta(table).alignments).toEqual(['center']);
	});

	it('advances from a non-none starting alignment without resetting', () => {
		const table = parseTable('| A |\n| :--- |\n| 1 |\n');
		expect(meta(table).alignments).toEqual(['left']);
		cycleAlignment(table, 0);
		expect(meta(table).alignments).toEqual(['center']);
	});
});

describe('setAlignment', () => {
	it('sets a single column alignment directly', () => {
		const table = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		setAlignment(table, 1, 'right');
		expect(meta(table).alignments).toEqual(['none', 'right']);
	});
});
