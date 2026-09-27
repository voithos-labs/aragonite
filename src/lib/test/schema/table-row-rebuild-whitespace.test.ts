// Miss-analysis: cell trimming was tested with ASCII padding only, so no case put a non-breaking
// space at a cell's edge, where `String.trim()` dropped it on the first edit to its row.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { rebuildTableRaw, rebuildTableRowRaw } from '$lib/schema/container-rebuilders';

const NBSP = String.fromCharCode(0xa0);

describe('a table row rebuild', () => {
	it('keeps a non-breaking space at the edge of a cell it did not edit', () => {
		const doc = parse(`| ${NBSP}a${NBSP} | b |\n| --- | --- |\n`);
		const table = doc.children[0];
		const header = table.children![0];
		header.children![1].raw = 'bc';

		rebuildTableRowRaw(header);
		rebuildTableRaw(table);

		expect(serialize(doc)).toBe(`| ${NBSP}a${NBSP} | bc |\n| --- | --- |\n`);
	});
});
