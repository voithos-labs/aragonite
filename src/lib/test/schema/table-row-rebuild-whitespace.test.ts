// Miss-analysis: only ASCII cell padding was tested, so `String.trim()` eating a nbsp went unseen.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { rebuildTableRaw, rebuildTableRowRaw } from '#lib/schema/container-rebuilders.js';

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
