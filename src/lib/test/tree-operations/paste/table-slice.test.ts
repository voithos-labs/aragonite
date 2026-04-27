import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { rebuildContainerRaw } from '../../../schema/container-raw';
import type { CstNode, TableMetadata, TableRowMetadata } from '../../../core/nodes';

const fixture = '| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n';

function tableFrom(src: string): CstNode {
	return parse(src).children[0];
}

describe('sliceTableAtRow', () => {
	it('rowGoes=first keeps the slice row in the first half', () => {
		const table = tableFrom(fixture);
		const { firstHalf, secondHalf } = sliceTableAtRow(table, 2, 'first');

		expect(firstHalf!.children).toHaveLength(3);
		expect(firstHalf!.children![0].children![0].raw).toBe('A');
		expect(firstHalf!.children![2].children![0].raw).toBe('3');

		expect(secondHalf!.children).toHaveLength(1);
		expect(secondHalf!.children![0].children![0].raw).toBe('5');
		expect((secondHalf!.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
	});

	it('rowGoes=second moves the slice row into the second half', () => {
		const table = tableFrom(fixture);
		const { firstHalf, secondHalf } = sliceTableAtRow(table, 2, 'second');

		expect(firstHalf!.children).toHaveLength(2);
		expect(firstHalf!.children![1].children![0].raw).toBe('1');

		expect(secondHalf!.children).toHaveLength(2);
		expect(secondHalf!.children![0].children![0].raw).toBe('3');
		expect((secondHalf!.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
	});

	it('returns null secondHalf when the slice consumes every row', () => {
		const table = tableFrom(fixture);
		const { firstHalf, secondHalf } = sliceTableAtRow(table, 3, 'first');
		expect(firstHalf!.children).toHaveLength(4);
		expect(secondHalf).toBeNull();
	});

	it('returns null firstHalf when slicing from row 0 with rowGoes=second', () => {
		const table = tableFrom(fixture);
		const { firstHalf, secondHalf } = sliceTableAtRow(table, 0, 'second');
		expect(firstHalf).toBeNull();
		expect(secondHalf!.children).toHaveLength(4);
		expect((secondHalf!.children![0].metadata as TableRowMetadata).isHeader).toBe(true);
	});

	it('preserves alignments on both halves and rebuilds raw', () => {
		const table = tableFrom(fixture);
		const { firstHalf, secondHalf } = sliceTableAtRow(table, 2, 'first');

		expect((firstHalf!.metadata as TableMetadata).alignments).toEqual(['left', 'right']);
		expect((secondHalf!.metadata as TableMetadata).alignments).toEqual(['left', 'right']);

		rebuildContainerRaw(firstHalf!);
		rebuildContainerRaw(secondHalf!);
		expect(firstHalf!.raw).toContain('| A | B |');
		expect(firstHalf!.raw).toContain('| :--- | ---: |');
		expect(secondHalf!.raw).toContain('| 5 | 6 |');
		expect(secondHalf!.raw).toContain('| :--- | ---: |');
	});

	it('does not mutate the original table', () => {
		const table = tableFrom(fixture);
		const originalChildren = table.children;
		const originalRowCount = table.children!.length;
		const originalRow0 = table.children![0];
		const originalRow0Header = (originalRow0.metadata as TableRowMetadata).isHeader;
		const originalRow2Header = (table.children![2].metadata as TableRowMetadata).isHeader;
		const originalAlignments = (table.metadata as TableMetadata).alignments;

		sliceTableAtRow(table, 2, 'first');

		expect(table.children).toBe(originalChildren);
		expect(table.children!.length).toBe(originalRowCount);
		expect(table.children![0]).toBe(originalRow0);
		expect((table.children![0].metadata as TableRowMetadata).isHeader).toBe(originalRow0Header);
		expect((table.children![2].metadata as TableRowMetadata).isHeader).toBe(originalRow2Header);
		expect((table.metadata as TableMetadata).alignments).toBe(originalAlignments);
	});

	it('clones cells so mutating a half does not leak back into the source', () => {
		const table = tableFrom(fixture);
		const sourceCell = table.children![2].children![0];
		const sourceCellRaw = sourceCell.raw;

		const { firstHalf } = sliceTableAtRow(table, 2, 'first');
		const halfCell = firstHalf!.children![2].children![0];

		expect(halfCell).not.toBe(sourceCell);
		halfCell.raw = 'mutated';
		expect(sourceCell.raw).toBe(sourceCellRaw);

		const sourceMeta = table.metadata as TableMetadata;
		const halfMeta = firstHalf!.metadata as TableMetadata;
		expect(halfMeta.alignments).not.toBe(sourceMeta.alignments);
	});
});
