import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { cloneDocument, serializeMutable, assignIds, generateBlockId } from '../mutable-tree';

describe('parse produces mutable nodes', () => {
	it('allows mutation of parsed node fields', () => {
		const doc = parse('# Title\n');
		doc.children[0].raw = '# Changed\n';
		expect(doc.children[0].raw).toBe('# Changed\n');
	});

	it('preserves node kind and raw on children', () => {
		const source = '# Title\n\nParagraph text.\n';
		const doc = parse(source);

		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('# Title\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('Paragraph text.\n');
	});

	it('preserves metadata', () => {
		const doc = parse('## Hello\n');
		expect(doc.children[0].metadata).toEqual({ level: 2 });
	});

	it('preserves leading trivia', () => {
		const doc = parse('# A\n\n\n# B\n');
		expect(doc.children[0].leadingTrivia).toBe('');
		expect(doc.children[1].leadingTrivia).toBe('\n\n');
	});

	it('preserves container block children', () => {
		const doc = parse('> Hello\n> World\n');
		expect(doc.children[0].kind).toBe('blockquote');
		expect(doc.children[0].children).toBeDefined();
		expect(doc.children[0].children!.length).toBeGreaterThan(0);
	});
});

describe('serializeMutable', () => {
	it('produces the same output as serialize', () => {
		const source = '# Title\n\nParagraph text.\n\n```js\ncode\n```\n';
		const doc = parse(source);

		expect(serializeMutable(doc)).toBe(serialize(doc));
		expect(serializeMutable(doc)).toBe(source);
	});

	it('reflects mutations in serialized output', () => {
		const doc = parse('# Title\n');
		doc.children[0].raw = '# Changed\n';
		expect(serializeMutable(doc)).toBe('# Changed\n');
	});

	it('handles empty document', () => {
		const doc = parse('');
		expect(serializeMutable(doc)).toBe('');
	});
});

describe('cloneDocument', () => {
	it('produces a deep copy', () => {
		const doc = parse('# Title\n\nText.\n');
		const cloned = cloneDocument(doc);

		cloned.children[0].raw = '# Modified\n';
		expect(doc.children[0].raw).toBe('# Title\n');
	});

	it('serializes identically to the original', () => {
		const doc = parse('# Title\n\nText.\n\n> Quote\n');
		const cloned = cloneDocument(doc);

		expect(serializeMutable(cloned)).toBe(serializeMutable(doc));
	});

	it('deep clones container children', () => {
		const doc = parse('> Hello\n');
		const cloned = cloneDocument(doc);

		cloned.children[0].children![0].raw = 'Modified\n';
		expect(doc.children[0].children![0].raw).not.toBe('Modified\n');
	});
});

describe('assignIds', () => {
	it('returns an array of unique IDs matching children length', () => {
		const doc = parse('# A\n\n# B\n\n# C\n');
		const ids = assignIds(doc.children);

		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	it('generates unique IDs (UUIDs)', () => {
		const id1 = generateBlockId();
		const id2 = generateBlockId();
		expect(id1).not.toBe(id2);
		expect(typeof id1).toBe('string');
		expect(id1.length).toBeGreaterThan(0);
	});
});
