import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
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

describe('structural: HTML blocks (CommonMark §4.6)', () => {
	it('same-line close yields a one-line htmlBlock followed by paragraph', () => {
		const doc = parse('<script>foo</script>\nafter\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('htmlBlock');
		expect(doc.children[0].raw).toBe('<script>foo</script>\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('after\n');
	});

	it('content after type-1 close becomes a separate paragraph (not absorbed)', () => {
		const doc = parse('<script>\nfoo\n</script>\nafter\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[1].kind).toBe('paragraph');
	});

	it('<textarea> produces an htmlBlock (previously fell through to paragraph)', () => {
		const doc = parse('<textarea>\ntext\n</textarea>\n');
		expect(doc.children[0].kind).toBe('htmlBlock');
	});

	it('<custom-tag>\\n\\nfoo produces htmlBlock + paragraph (type 7 detection)', () => {
		const doc = parse('<custom-tag>\n\nfoo\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('htmlBlock');
		expect(doc.children[1].kind).toBe('paragraph');
	});

	it('paragraph interruption: <div> after a paragraph line splits cleanly', () => {
		const doc = parse('Hello\n<div>\ncontent\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('htmlBlock');
	});

	it('type 7 does NOT interrupt a paragraph', () => {
		const doc = parse('Hello\n<custom-tag>\ncontent\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
	});
});
