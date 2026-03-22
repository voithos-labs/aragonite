import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { toMutable, serializeMutable } from '../mutable-tree';
import { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from '../tree-operations';

describe('splitNode', () => {
	it('splits a paragraph into two paragraphs', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].raw).toBe('Hello\n');
		expect(mutable.children[1].raw).toBe(' World\n');
		expect(mutable.children[0].kind).toBe('paragraph');
		expect(mutable.children[1].kind).toBe('paragraph');
	});

	it('preserves the original ID and assigns a new one', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['original-id'];
		splitNode(mutable, ids, 0, 5);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe('original-id');
		expect(ids[1]).not.toBe('original-id');
	});

	it('splits at the beginning creates empty first paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 0);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].kind).toBe('paragraph');
		expect(mutable.children[0].raw).toBe('\n');
		expect(mutable.children[1].raw).toBe('Hello\n');
	});

	it('splits at the end creates empty second paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].raw).toBe('Hello\n');
		expect(mutable.children[1].kind).toBe('paragraph');
		expect(mutable.children[1].raw).toBe('\n');
	});

	it('second block has empty leading trivia (no blank line)', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		expect(mutable.children[1].leadingTrivia).toBe('');
	});

	it('preserves leading trivia on the first block when splitting a non-first block', () => {
		const source = 'First\n\nSecond\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2'];
		splitNode(mutable, ids, 1, 3);
		expect(mutable.children[1].leadingTrivia).toBe('\n');
		expect(mutable.children[2].leadingTrivia).toBe('');
	});

	it('handles multi-line paragraph split', () => {
		const source = 'Line one.\nLine two.\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 10);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].raw).toBe('Line one.\n');
		expect(mutable.children[1].raw).toBe('Line two.\n');
	});

	it('produces correct serialization after split', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		const result = serializeMutable(mutable);
		expect(result).toBe('Hello\n World\n');
	});

	it('handles CRLF line endings correctly', () => {
		const source = 'Hello World\r\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		expect(mutable.children[0].raw).toBe('Hello\r\n');
		expect(mutable.children[1].raw).toBe(' World\r\n');
	});
});

describe('mergeWithPrevious', () => {
	it('merges two paragraphs into one (strips internal line break)', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(mutable, ids, 1);
		expect(mutable.children).toHaveLength(1);
		expect(mutable.children[0].kind).toBe('paragraph');
		expect(mutable.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the first block ID and removes the second', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['keep-me', 'remove-me'];
		mergeWithPrevious(mutable, ids, 1);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the first block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2', 'id-3'];
		mergeWithPrevious(mutable, ids, 2);
		expect(mutable.children[1].leadingTrivia).toBe('\n');
	});

	it('does nothing when blockIndex is 0', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		mergeWithPrevious(mutable, ids, 0);
		expect(mutable.children).toHaveLength(1);
		expect(ids).toEqual(['id-1']);
	});

	it('re-parses to determine merged block type', () => {
		const doc = parse('');
		const mutable = toMutable(doc);
		mutable.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(mutable, ids, 1);
		expect(mutable.children[0].kind).toBe('heading');
		expect(mutable.children[0].raw).toBe('## Title\n');
	});
});

describe('deleteNode', () => {
	it('removes the node at the given index', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2', 'id-3'];
		deleteNode(mutable, ids, 1);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].raw).toBe('A\n');
		expect(mutable.children[1].raw).toBe('C\n');
		expect(ids).toEqual(['id-1', 'id-3']);
	});

	it('transfers leading trivia to the next block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2', 'id-3'];
		const triviaB = mutable.children[1].leadingTrivia;
		const triviaC = mutable.children[2].leadingTrivia;
		deleteNode(mutable, ids, 1);
		expect(mutable.children[1].leadingTrivia).toBe(triviaB + triviaC);
	});
});

describe('splitNode edge cases', () => {
	it('splits the only node in the document', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 5);
		expect(mutable.children).toHaveLength(2);
		expect(serializeMutable(mutable)).toBe('Hello\n World\n');
	});

	it('split at offset beyond raw length produces empty second block', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		splitNode(mutable, ids, 0, 100);
		expect(mutable.children).toHaveLength(2);
		expect(mutable.children[0].raw).toBe('Hello\n');
		expect(mutable.children[1].raw).toBe('\n');
	});
});

describe('mergeWithPrevious edge cases', () => {
	it('does nothing when blockIndex is out of bounds', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(mutable, ids, 5);
		expect(mutable.children).toHaveLength(2);
		expect(ids).toHaveLength(2);
	});
});

describe('deleteNode edge cases', () => {
	it('deleting the only node leaves empty document', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1'];
		deleteNode(mutable, ids, 0);
		expect(mutable.children).toHaveLength(0);
		expect(ids).toHaveLength(0);
	});

	it('deleting the first node transfers trivia correctly', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2'];
		deleteNode(mutable, ids, 0);
		expect(mutable.children).toHaveLength(1);
		expect(mutable.children[0].raw).toBe('B\n');
	});

	it('deleting the last node does not crash', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const ids = ['id-1', 'id-2'];
		deleteNode(mutable, ids, 1);
		expect(mutable.children).toHaveLength(1);
		expect(mutable.children[0].raw).toBe('A\n');
	});
});

describe('updateNodeContent', () => {
	it('updates the raw text of a node', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const result = updateNodeContent(mutable, 0, 'World\n');
		expect(mutable.children[0].raw).toBe('World\n');
		expect(result.kindChanged).toBe(false);
	});

	it('detects block type change from paragraph to heading', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const result = updateNodeContent(mutable, 0, '## Hello\n');
		expect(mutable.children[0].kind).toBe('heading');
		expect(mutable.children[0].metadata).toEqual({ level: 2 });
		expect(result.kindChanged).toBe(true);
		expect(result.newKind).toBe('heading');
	});

	it('detects block type change from heading to paragraph', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const result = updateNodeContent(mutable, 0, 'Hello\n');
		expect(mutable.children[0].kind).toBe('paragraph');
		expect(result.kindChanged).toBe(true);
		expect(result.newKind).toBe('paragraph');
	});

	it('preserves leading trivia and ID position', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		updateNodeContent(mutable, 1, 'Changed\n');
		expect(mutable.children[1].leadingTrivia).toBe('\n');
		expect(mutable.children[1].raw).toBe('Changed\n');
	});

	it('handles empty string content without crashing', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const result = updateNodeContent(mutable, 0, '');
		expect(mutable.children[0].raw).toBe('');
		expect(mutable.children[0].kind).toBe('paragraph');
	});

	it('with multi-block content uses only first block kind', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		const result = updateNodeContent(mutable, 0, '# Heading\n\nParagraph\n');
		// The raw is stored as-is (the full multi-block text)
		expect(mutable.children[0].raw).toBe('# Heading\n\nParagraph\n');
		// But kind is determined by re-parsing — only the first block matters
		expect(mutable.children[0].kind).toBe('heading');
		// Document still has 1 child (updateNodeContent doesn't split)
		expect(mutable.children).toHaveLength(1);
	});

	it('clears metadata when block type changes from heading to paragraph', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		const mutable = toMutable(doc);
		expect(mutable.children[0].metadata).toEqual({ level: 2 });
		updateNodeContent(mutable, 0, 'Hello\n');
		expect(mutable.children[0].metadata).toBeUndefined();
	});
});
