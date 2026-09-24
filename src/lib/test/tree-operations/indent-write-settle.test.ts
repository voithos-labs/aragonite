import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// A write that keeps its block's kind skips the neighbour merge, but a new first-line indent is
// what moves a paragraph under a loose list item into it, so that write asks anyway (GH #457).
// Miss-analysis: the join suites changed kinds or filled blank lines, and no case indented a
// paragraph by less than the four spaces that turn it into code.

describe('a write that indents its first line settles the join above', () => {
	it.each([
		['two spaces under a bullet', '- a\n\nzz\n', '  zz\n'],
		['three spaces under an ordered item', '1. a\n\nzz\n', '   zz\n'],
		['two spaces under the outer of two nested items', '- a\n  - b\n\nzz\n', '  zz\n'],
		['four spaces under the inner item', '- a\n  - b\n\nzz\n', '    zz\n']
	])('joins the paragraph to the item on %s', (_label, source, text) => {
		const doc = parse(source);
		updateNodeContent(doc, 1, text);
		expect(doc.children.map((c) => c.kind)).toEqual(['list']);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('keeps a paragraph its own one space short of the item', () => {
		const doc = parse('1. a\n\nzz\n');
		updateNodeContent(doc, 1, '  zz\n');
		expect(serialize(doc)).toBe('1. a\n\n  zz\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);
		expect(describeConvergence(doc)).toBeNull();
	});
});

// The typing cost the skip exists for: a keystroke that leaves the indent alone asks nothing, so
// it leaves even a join the reload would make untouched. The tree here is diverged on purpose.
describe('a write that leaves the indent alone skips the join', () => {
	it('does not ask the list above about a paragraph it would absorb', () => {
		const doc = parse('- a\n\nzz\n');
		doc.children[1].raw = '  zz\n';
		updateNodeContent(doc, 1, '  zzx\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['list', 'paragraph']);
	});
});
