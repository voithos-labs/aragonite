import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import {
	toMutable,
	cloneDocument,
	serializeMutable,
	assignIds,
	generateBlockId
} from '../mutable-tree';

describe('toMutable', () => {
	it('converts a parsed document to a mutable document', () => {
		const source = '# Title\n\nParagraph text.\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(mutable.kind).toBe('document');
		expect(mutable.prefix).toBe(doc.prefix);
		expect(mutable.suffix).toBe(doc.suffix);
		expect(mutable.children).toHaveLength(doc.children.length);
	});

	it('preserves node kind and raw on children', () => {
		const source = '# Title\n\nParagraph text.\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(mutable.children[0].kind).toBe('heading');
		expect(mutable.children[0].raw).toBe('# Title\n');
		expect(mutable.children[1].kind).toBe('paragraph');
		expect(mutable.children[1].raw).toBe('Paragraph text.\n');
	});

	it('preserves metadata', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(mutable.children[0].metadata).toEqual({ level: 2 });
	});

	it('preserves leading trivia', () => {
		const source = '# A\n\n\n# B\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(mutable.children[0].leadingTrivia).toBe('');
		expect(mutable.children[1].leadingTrivia).toBe('\n\n');
	});

	it('preserves container block children', () => {
		const source = '> Hello\n> World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(mutable.children[0].kind).toBe('blockquote');
		expect(mutable.children[0].children).toBeDefined();
		expect(mutable.children[0].children!.length).toBeGreaterThan(0);
	});

	it('creates a mutable copy (not a reference)', () => {
		const source = '# Title\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		mutable.children[0].raw = '# Changed\n';
		expect(doc.children[0].raw).toBe('# Title\n');
	});
});

describe('serializeMutable', () => {
	it('produces the same output as serialize on the original CST', () => {
		const source = '# Title\n\nParagraph text.\n\n```js\ncode\n```\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		expect(serializeMutable(mutable)).toBe(serialize(doc));
		expect(serializeMutable(mutable)).toBe(source);
	});

	it('reflects mutations in serialized output', () => {
		const source = '# Title\n';
		const doc = parse(source);
		const mutable = toMutable(doc);

		mutable.children[0].raw = '# Changed\n';
		expect(serializeMutable(mutable)).toBe('# Changed\n');
	});

	it('handles empty document', () => {
		const doc = parse('');
		const mutable = toMutable(doc);
		expect(serializeMutable(mutable)).toBe('');
	});
});

describe('cloneDocument', () => {
	it('produces a deep copy', () => {
		const source = '# Title\n\nText.\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const cloned = cloneDocument(mutable);

		cloned.children[0].raw = '# Modified\n';
		expect(mutable.children[0].raw).toBe('# Title\n');
	});

	it('serializes identically to the original', () => {
		const source = '# Title\n\nText.\n\n> Quote\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const cloned = cloneDocument(mutable);

		expect(serializeMutable(cloned)).toBe(serializeMutable(mutable));
	});

	it('deep clones container children', () => {
		const source = '> Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const cloned = cloneDocument(mutable);

		cloned.children[0].children![0].raw = 'Modified\n';
		expect(mutable.children[0].children![0].raw).not.toBe('Modified\n');
	});
});

describe('assignIds', () => {
	it('returns an array of unique IDs matching children length', () => {
		const source = '# A\n\n# B\n\n# C\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = assignIds(mutable.children);

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
