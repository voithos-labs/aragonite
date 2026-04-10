import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serializeMutable } from '../mutable-tree';
import { splitNode } from '../tree-operations';

describe('splitNode', () => {
	it('splits a paragraph into two paragraphs', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].raw).toBe(' World\n');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('paragraph');
	});

	it('preserves the original ID and assigns a new one', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['original-id'];
		splitNode(doc, ids, 0, 5);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe('original-id');
		expect(ids[1]).not.toBe('original-id');
	});

	it('splits at the beginning creates empty first paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 0);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('\n');
		expect(doc.children[1].raw).toBe('Hello\n');
	});

	it('splits at the end creates empty second paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('\n');
	});

	it('second block has empty leading trivia (no blank line)', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		expect(doc.children[1].leadingTrivia).toBe('');
	});

	it('preserves leading trivia on the first block when splitting a non-first block', () => {
		const source = 'First\n\nSecond\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2'];
		splitNode(doc, ids, 1, 3);
		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(doc.children[2].leadingTrivia).toBe('');
	});

	it('handles multi-line paragraph split', () => {
		const source = 'Line one.\nLine two.\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 10);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Line one.\n');
		expect(doc.children[1].raw).toBe('Line two.\n');
	});

	it('produces correct serialization after split', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		const result = serializeMutable(doc);
		expect(result).toBe('Hello\n World\n');
	});

	it('handles CRLF line endings correctly', () => {
		const source = 'Hello World\r\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		expect(doc.children[0].raw).toBe('Hello\r\n');
		expect(doc.children[1].raw).toBe(' World\r\n');
	});
});

describe('splitNode edge cases', () => {
	it('splits the only node in the document', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 5);
		expect(doc.children).toHaveLength(2);
		expect(serializeMutable(doc)).toBe('Hello\n World\n');
	});

	it('split at offset beyond raw length produces empty second block', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 100);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].raw).toBe('\n');
	});
});

describe('heading split operations', () => {
	it('splits a heading into heading + paragraph', () => {
		const source = '## Hello World\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 8);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Hello\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe(' World\n');
	});

	it('splits a heading at start produces empty paragraph + heading', () => {
		const source = '## Title\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 0);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('\n');
		expect(doc.children[1].kind).toBe('heading');
		expect(doc.children[1].raw).toBe('## Title\n');
	});
});

describe('thematic break split', () => {
	it('splitting at end of thematic break produces break + empty paragraph', () => {
		const source = '---\n';
		const doc = parse(source);
		const ids = ['id-1'];
		splitNode(doc, ids, 0, 3);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('thematicBreak');
		expect(doc.children[0].raw).toBe('---\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('\n');
	});
});

describe('splitNode on arbitrary parent', () => {
	it('splitNode works on a container children array', () => {
		const parent = {
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello World\n' }]
		};
		const ids = ['id-1'];
		splitNode(parent, ids, 0, 5);
		expect(parent.children).toHaveLength(2);
		expect(parent.children[0].raw).toBe('Hello\n');
		expect(parent.children[1].raw).toBe(' World\n');
	});
});
