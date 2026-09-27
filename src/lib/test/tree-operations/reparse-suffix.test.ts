import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode, updateNodeContent } from '../../tree-operations';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import { fixtureReading } from '../harness/fixture-grammar';
import { defaultGrammarView } from '$lib/schema/block-openers';

// A fragment parse splits a half's trailing blank line off into `doc.suffix`, and that line stands
// between the halves, so it becomes the second half's `leadingTrivia`, not part of either raw.
// Miss-analysis: GH #97, no split case's raw held an interior blank line.

describe('a split half ending in a blank line keeps it (GH #97)', () => {
	it('re-attaches the stripped line as the second half’s separator', () => {
		const doc = parse('    a\n\n    b\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 7, undefined, fixtureReading());

		expect(doc.children.map((c) => [c.kind, c.leadingTrivia, c.raw])).toEqual([
			['indentedCode', '', '    a\n'],
			['indentedCode', '\n', '    b\n']
		]);
		expect(serialize(doc)).toBe('    a\n\n    b\n');
	});

	it('the CRLF variant keeps its CRLF line', () => {
		const doc = parse('    a\r\n\r\n    b\r\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 9, undefined, fixtureReading());

		expect(doc.children[1].leadingTrivia).toBe('\r\n');
		expect(serialize(doc)).toBe('    a\r\n\r\n    b\r\n');
	});

	// A run past the first line becomes blank blocks, so only one line is ever the parse's
	// suffix: the split must keep the blocks and the split-off line.
	it('keeps a longer blank run: blocks plus the stripped line', () => {
		const doc = parse('    a\n\n\n\n    b\n');
		expect(doc.children).toHaveLength(1);

		splitNode(doc, 0, 9, undefined, fixtureReading());

		expect(serialize(doc)).toBe('    a\n\n\n\n    b\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);
	});
});

// Miss-analysis: GH #97, every multi-block update ended flush at a block's last byte.
describe('a multi-block content write ending in a blank line keeps it (GH #97)', () => {
	it('keeps the stripped line in the last created block', () => {
		const doc = parse('x\n');

		updateNodeContent(doc, 0, '# h\na\n\n', defaultGrammarView);

		expect(serialize(doc)).toBe('# h\na\n\n');
	});

	it('the CRLF variant keeps its CRLF line', () => {
		const doc = parse('x\r\n');

		updateNodeContent(doc, 0, '# h\r\na\r\n\r\n', defaultGrammarView);

		expect(serialize(doc)).toBe('# h\r\na\r\n\r\n');
	});
});
