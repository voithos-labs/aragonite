// Miss-analysis: the row rebuild's fix had no sibling test on the two paste routes into a cell,
// which trimmed their own copies of a row with `String.trim()` and dropped an edge NBSP.
import { describe, expect, it } from 'vitest';
import { parseClipboardGrid } from '$lib/tree-operations/table-grid-clipboard';
import { normalizeWhitespace } from '$lib/components/blocks/table/table-cell-paste';

const NBSP = '\u00a0';

describe('a paste into a table cell', () => {
	it('keeps a non-breaking space at a cell edge in a copied GFM grid', () => {
		const grid = `| ${NBSP}a | b${NBSP} |\n| --- | --- |\n| c | d |\n`;
		expect(parseClipboardGrid(grid)).toEqual([
			[`${NBSP}a`, `b${NBSP}`],
			['c', 'd']
		]);
	});

	it('keeps a trailing line holding a non-breaking space as a row', () => {
		expect(parseClipboardGrid(`a\tb\n${NBSP}\n`)).toEqual([
			['a', 'b'],
			[NBSP, '']
		]);
	});

	it('keeps a non-breaking space at the edge of pasted text', () => {
		expect(normalizeWhitespace(` ${NBSP}a\nb${NBSP} \n`)).toBe(`${NBSP}a b${NBSP}`);
	});
});
