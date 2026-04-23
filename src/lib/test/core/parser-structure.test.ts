import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import type { HeadingMetadata, ListMetadata } from '../../core/nodes';

// Structural edge cases of the parser: degenerate inputs (7 hashes, empty
// heading), document-level prefix/suffix capture, container-children shape,
// and adjacent-block boundaries. Per-block metadata assertions live in
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

describe('structural: document prefix/suffix', () => {
	it('captures leading blank lines as prefix', () => {
		const doc = parse('\n\n# Title\n');
		expect(doc.prefix).toBe('\n\n');
		expect(doc.children.length).toBe(1);
	});

	it('captures trailing blank lines as suffix', () => {
		const doc = parse('# Title\n\n\n');
		expect(doc.suffix).toBe('\n\n');
		expect(doc.children.length).toBe(1);
	});

	it('empty document has empty prefix/suffix', () => {
		const doc = parse('');
		expect(doc.prefix).toBe('');
		expect(doc.suffix).toBe('');
		expect(doc.children.length).toBe(0);
	});

	it('only blank lines go into prefix', () => {
		const doc = parse('\n\n\n');
		expect(doc.prefix).toBe('\n\n\n');
		expect(doc.children.length).toBe(0);
		expect(doc.suffix).toBe('');
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
