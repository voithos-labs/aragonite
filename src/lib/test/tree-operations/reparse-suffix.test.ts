import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode, updateNodeContent } from '../../tree-operations';
import { takeDevWarns } from '$lib/test/support/warn-gate';

// GH #97: a fragment parse peels a half's trailing blank line into `doc.suffix`, and the
// reparse funnel dropped it. The line stands between the halves, so it is the second half's
// separator (`leadingTrivia`) per the blank-line rule — not part of either half's raw.
// Miss-analysis: every split pin used raws without interior blank lines, so no half could
// end in one; only indented code puts a blank line inside a leaf's raw.

describe('a split half ending in a blank line keeps it (GH #97)', () => {
	it('re-attaches the peeled line as the second half’s separator', () => {
		const doc = parse('    a\n\n    b\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 7, undefined, undefined, undefined);

		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['indentedCode', '', '    a\n'],
			['indentedCode', '\n', '    b\n']
		]);
		expect(serialize(doc)).toBe('    a\n\n    b\n');
	});

	it('the CRLF twin keeps its CRLF line', () => {
		const doc = parse('    a\r\n\r\n    b\r\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 9, undefined, undefined, undefined);

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
		expect(serialize(doc)).toBe('    a\r\n\r\n    b\r\n');
	});

	// A run past the first line materializes as blank blocks, so only ONE line is ever the
	// parse's suffix — the split must keep the blocks AND the peeled line.
	it('keeps a longer blank run: blocks plus the peeled line', () => {
		const doc = parse('    a\n\n\n\n    b\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 9, undefined, undefined, undefined);

		expect(serialize(doc)).toBe('    a\n\n\n\n    b\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);
	});
});

// Miss-analysis: the multi-block update pins all ended flush at a block's last byte, so the
// fragment parse never peeled a suffix out of a committed text.
describe('a multi-block content write ending in a blank line keeps it (GH #97)', () => {
	it('keeps the peeled line in the last minted block', () => {
		const doc = parse('x\n');

		updateNodeContent(doc, 0, '# h\na\n\n');

		expect(serialize(doc)).toBe('# h\na\n\n');
	});

	it('the CRLF twin keeps its CRLF line', () => {
		const doc = parse('x\r\n');

		updateNodeContent(doc, 0, '# h\r\na\r\n\r\n');

		expect(serialize(doc)).toBe('# h\r\na\r\n\r\n');
	});
});
