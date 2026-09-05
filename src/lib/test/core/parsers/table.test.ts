import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import type { TableMetadata, TableRowMetadata } from '../../../core/nodes';

describe('table parser: structure', () => {
	it('produces a table → tableRow → tableCell tree', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const table = doc.children[0];
		expect(table.kind).toBe('table');
		expect((table.metadata as TableMetadata).columnCount).toBe(2);
		expect((table.metadata as TableMetadata).alignments).toEqual(['none', 'none']);
		expect(table.children).toHaveLength(2);

		const header = table.children![0];
		expect(header.kind).toBe('tableRow');
		expect((header.metadata as TableRowMetadata).isHeader).toBe(true);
		expect(header.children).toHaveLength(2);
		expect(header.children![0].kind).toBe('tableCell');
		expect(header.children![0].raw).toBe('A');
		expect(header.children![1].raw).toBe('B');

		const body = table.children![1];
		expect(body.kind).toBe('tableRow');
		expect((body.metadata as TableRowMetadata).isHeader).toBe(false);
		expect(body.children![0].raw).toBe('1');
		expect(body.children![1].raw).toBe('2');
	});

	it('captures alignments from the delimiter row', () => {
		const doc = parse('| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |\n');
		const table = doc.children[0];
		expect((table.metadata as TableMetadata).alignments).toEqual(['left', 'center', 'right']);
	});

	it('preserves escaped pipes in cell raw', () => {
		const doc = parse('| a | b \\| c |\n| --- | --- |\n');
		const table = doc.children[0];
		expect(table.children![0].children![1].raw).toBe('b \\| c');
	});

	it('supports header-only tables (no body rows)', () => {
		const doc = parse('| A | B |\n| --- | --- |\n');
		const table = doc.children[0];
		expect(table.children).toHaveLength(1);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
	});

	it('captures leadingTrivia on the table block, not on its children', () => {
		const doc = parse('# T\n\n| A |\n| --- |\n| x |\n');
		const table = doc.children[1];
		expect(table.leadingTrivia).toBe('\n');
		expect(table.children![0].leadingTrivia).toBe('');
	});

	it('pads body rows shorter than the header to columnCount with empty cells', () => {
		const doc = parse('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n');
		const table = doc.children[0];
		const body = table.children![1];
		expect(body.children).toHaveLength(3);
		expect(body.children![0].raw).toBe('1');
		expect(body.children![1].raw).toBe('2');
		expect(body.children![2].raw).toBe('');
	});

	it('truncates body rows longer than the header to columnCount', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 | 3 | 4 |\n');
		const table = doc.children[0];
		const body = table.children![1];
		expect(body.children).toHaveLength(2);
		expect(body.children![0].raw).toBe('1');
		expect(body.children![1].raw).toBe('2');
	});

	// GFM §4.10 requires matching cell counts; accepting a mismatch drops surplus header
	// cells from the model and destroys them on the first edit.
	const mismatches = [
		{ name: 'fewer delimiter cells than header', source: 'a|b\n|---|\n' },
		{ name: 'fewer header cells than delimiter', source: 'a|b\n|--|--|--|\n' }
	];

	for (const { name, source } of mismatches) {
		it(`rejects a header/delimiter cell-count mismatch (${name})`, () => {
			const doc = parse(source);
			expect(doc.children[0].kind).toBe('paragraph');
			expect(serialize(doc)).toBe(source);
		});
	}

	it('still recognizes the matching-count sibling of a rejected shape', () => {
		const doc = parse('a|b\n|---|---|\n');
		expect(doc.children[0].kind).toBe('table');
		expect((doc.children[0].metadata as TableMetadata).columnCount).toBe(2);
	});

	it('terminates the table at the first line without a pipe', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\nNot a row\n');
		expect(doc.children).toHaveLength(2);
		const table = doc.children[0];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(2);
		const para = doc.children[1];
		expect(para.kind).toBe('paragraph');
		expect(para.raw).toContain('Not a row');
	});

	// Miss-analysis: mutation-testing tableHeaderCells showed dropping its pipe guard flipped
	// pipeless prose above a delimiter row into a table with every suite green (GFM § 4.10).
	it('refuses a header row with no pipe: prose above a delimiter line stays a paragraph', () => {
		const doc = parse('plain prose\n| --- |\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph']);
	});
});
