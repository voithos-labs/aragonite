import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { rebuildContainerRaw } from '../../schema/container-raw';
import type { TableMetadata } from '../../core/nodes';

describe('container-raw: tableRow', () => {
	it('rebuilds raw from cells with single-space padding and trailing newline', () => {
		const doc = parse('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
		const table = doc.children[0];
		const headerRow = table.children![0];
		headerRow.children![0].raw = 'Name';
		rebuildContainerRaw(headerRow);
		expect(headerRow.raw).toBe('| Name | B |\n');
	});

	it('rebuilds raw with empty cells', () => {
		const doc = parse('| A | B |\n| --- | --- |\n');
		const headerRow = doc.children[0].children![0];
		headerRow.children![0].raw = '';
		rebuildContainerRaw(headerRow);
		expect(headerRow.raw).toBe('|  | B |\n');
	});
});

describe('container-raw: table', () => {
	it('rebuilds raw from rows + canonical delimiter row', () => {
		const doc = parse('| A | B |\n| :--- | ---: |\n| 1 | 2 |\n');
		const table = doc.children[0];
		rebuildContainerRaw(table);
		expect(table.raw).toBe('| A | B |\n| :--- | ---: |\n| 1 | 2 |\n');
	});

	it('canonicalizes the delimiter row from metadata.alignments', () => {
		const doc = parse('| A | B | C | D |\n|:---|:---:|---:|---|\n');
		const table = doc.children[0];
		expect((table.metadata as TableMetadata).alignments).toEqual([
			'left',
			'center',
			'right',
			'none'
		]);
		rebuildContainerRaw(table);
		expect(table.raw).toBe('| A | B | C | D |\n| :--- | :---: | ---: | --- |\n');
	});

	it('synthesizes delimiter when table has only a header row', () => {
		const doc = parse('| A | B |\n| --- | --- |\n');
		const table = doc.children[0];
		rebuildContainerRaw(table);
		expect(table.raw).toBe('| A | B |\n| --- | --- |\n');
	});
});
