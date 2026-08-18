import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { HeadingMetadata, ListMetadata } from '../../core/nodes';

// Structural edge cases only; the per-block metadata assertions live in
// parser-metadata.test.ts.

describe('structural: headings', () => {
	it('7 hashes is a paragraph, not a heading', () => {
		const doc = parse('####### Not a heading\n');
		expect(doc.children[0].kind).toBe('paragraph');
	});

	it('empty heading is still a heading', () => {
		const doc = parse('#\n');
		expect(doc.children[0].kind).toBe('heading');
		expect((doc.children[0].metadata as HeadingMetadata).level).toBe(1);
	});
});

// The blank-line layout itself is pinned in core/blank-line-blocks.test.ts; these hold the
// two document fields against it.
describe('structural: document prefix/suffix', () => {
	it('leaves prefix empty — a leading blank line is a block, not document whitespace', () => {
		const doc = parse('\n\n# Title\n');
		expect(doc.prefix).toBe('');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'paragraph', 'heading']);
	});

	it('captures a lone trailing blank line as suffix', () => {
		const doc = parse('# Title\n\n');
		expect(doc.suffix).toBe('\n');
		expect(doc.children.length).toBe(1);
	});

	it('empty document has empty prefix/suffix', () => {
		const doc = parse('');
		expect(doc.prefix).toBe('');
		expect(doc.suffix).toBe('');
		expect(doc.children.length).toBe(0);
	});
});

describe('structural: blockquote children', () => {
	it('blockquote containing a list has list children', () => {
		const doc = parse('> - A\n> - B\n');
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children!.length).toBeGreaterThan(0);
		expect(bq.children![0].kind).toBe('list');
	});

	it('blockquote innerPrefix/innerSuffix are strings', () => {
		const doc = parse('> # Title\n');
		const bq = doc.children[0];
		expect(typeof bq.innerPrefix).toBe('string');
		expect(typeof bq.innerSuffix).toBe('string');
	});
});

describe('structural: blockquote lazy continuation (CommonMark §5.1)', () => {
	it('absorbs a lazy continuation line into an open paragraph', () => {
		const doc = parse('> First line\nlazy continuation\n');
		expect(doc.children).toHaveLength(1);
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children).toHaveLength(1);
		const para = bq.children![0];
		expect(para.kind).toBe('paragraph');
		expect(para.raw).toContain('First line');
		expect(para.raw).toContain('lazy continuation');
	});

	it('absorbs multiple consecutive non-> lines', () => {
		const doc = parse('> A\nB\nC\n');
		const bq = doc.children[0];
		expect(bq.kind).toBe('blockquote');
		expect(bq.children).toHaveLength(1);
		expect(bq.children![0].kind).toBe('paragraph');
		expect(bq.children![0].raw).toBe('A\nB\nC\n');
	});

	it('stops at a blank line', () => {
		const doc = parse('> inside\nlazy\n\nafter\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('blockquote');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('after\n');
	});

	it('does not absorb a new block opener', () => {
		const doc = parse('> quoted\n# heading\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('blockquote');
		expect(doc.children[1].kind).toBe('heading');
	});

	it('preserves round-trip', () => {
		const source = '> First line\nlazy continuation\n';
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
	});
});

describe('structural: nested lists', () => {
	it('nested unordered list produces list inside list item', () => {
		const doc = parse('- Item\n  - Nested\n');
		expect(doc.children).toHaveLength(1);
		const list = doc.children[0];
		expect(list.kind).toBe('list');
		expect(list.children).toHaveLength(1);
		const item = list.children![0];
		expect(item.kind).toBe('listItem');
		expect(item.children).toHaveLength(2);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![1].kind).toBe('list');
		const nested = item.children![1];
		expect(nested.children).toHaveLength(1);
		expect(nested.children![0].kind).toBe('listItem');
	});

	it('continuation line merges into item paragraph', () => {
		const doc = parse('- Line 1\n  Line 2\n');
		const item = doc.children[0].children![0];
		expect(item.children).toHaveLength(1);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![0].raw).toBe('Line 1\nLine 2\n');
	});

	it('multi-paragraph item has multiple children', () => {
		const doc = parse('- Para 1\n\n  Para 2\n');
		const item = doc.children[0].children![0];
		expect(item.children).toHaveLength(2);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![1].kind).toBe('paragraph');
	});

	it('deeply nested list', () => {
		const doc = parse('- L1\n  - L2\n    - L3\n');
		const l1Item = doc.children[0].children![0];
		const l2List = l1Item.children!.find((c) => c.kind === 'list');
		expect(l2List).toBeDefined();
		const l2Item = l2List!.children![0];
		const l3List = l2Item.children!.find((c) => c.kind === 'list');
		expect(l3List).toBeDefined();
		expect(l3List!.children![0].kind).toBe('listItem');
	});
});

describe('structural: mixed list types', () => {
	it('adjacent different list types produce separate blocks', () => {
		const doc = parse('- A\n\n1. B\n');
		expect(doc.children.length).toBe(2);
		expect(doc.children[0].kind).toBe('list');
		expect((doc.children[0].metadata as ListMetadata).ordered).toBe(false);
		expect(doc.children[1].kind).toBe('list');
		expect((doc.children[1].metadata as ListMetadata).ordered).toBe(true);
	});
});
