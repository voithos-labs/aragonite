import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serializeMutable } from '../mutable-tree';
import { splitNode, mergeWithPrevious, deleteNode, updateNodeContent } from '../tree-operations';

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

describe('mergeWithPrevious', () => {
	it('merges two paragraphs into one (strips internal line break)', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(doc, ids, 1);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the first block ID and removes the second', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const ids = ['keep-me', 'remove-me'];
		mergeWithPrevious(doc, ids, 1);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the first block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2', 'id-3'];
		mergeWithPrevious(doc, ids, 2);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('does nothing when blockIndex is 0', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		mergeWithPrevious(doc, ids, 0);
		expect(doc.children).toHaveLength(1);
		expect(ids).toEqual(['id-1']);
	});

	it('re-parses to determine merged block type', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(doc, ids, 1);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Title\n');
	});
});

describe('deleteNode', () => {
	it('removes the node at the given index', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2', 'id-3'];
		deleteNode(doc, ids, 1);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('A\n');
		expect(doc.children[1].raw).toBe('C\n');
		expect(ids).toEqual(['id-1', 'id-3']);
	});

	it('transfers leading trivia to the next block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2', 'id-3'];
		const triviaB = doc.children[1].leadingTrivia;
		const triviaC = doc.children[2].leadingTrivia;
		deleteNode(doc, ids, 1);
		expect(doc.children[1].leadingTrivia).toBe(triviaB + triviaC);
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

describe('mergeWithPrevious edge cases', () => {
	it('does nothing when blockIndex is out of bounds', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(doc, ids, 5);
		expect(doc.children).toHaveLength(2);
		expect(ids).toHaveLength(2);
	});
});

describe('deleteNode edge cases', () => {
	it('deleting the only node leaves empty document', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		deleteNode(doc, ids, 0);
		expect(doc.children).toHaveLength(0);
		expect(ids).toHaveLength(0);
	});

	it('deleting the first node transfers trivia correctly', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2'];
		deleteNode(doc, ids, 0);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('B\n');
	});

	it('deleting the last node does not crash', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2'];
		deleteNode(doc, ids, 1);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('A\n');
	});
});

describe('heading operations', () => {
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

	it('merges heading + paragraph into heading', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'heading', leadingTrivia: '', raw: '## Hello\n', metadata: { level: 2 } },
			{ kind: 'paragraph', leadingTrivia: '', raw: ' World\n' }
		];
		const ids = ['id-1', 'id-2'];
		mergeWithPrevious(doc, ids, 1);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Hello World\n');
	});
});

describe('updateNodeContent', () => {
	it('updates the raw text of a node', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const result = updateNodeContent(doc, 0, 'World\n');
		expect(doc.children[0].raw).toBe('World\n');
		expect(result.kindChanged).toBe(false);
	});

	it('detects block type change from paragraph to heading', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const result = updateNodeContent(doc, 0, '## Hello\n');
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].metadata).toEqual({ level: 2 });
		expect(result.kindChanged).toBe(true);
		expect(result.newKind).toBe('heading');
	});

	it('detects block type change from heading to paragraph', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		const result = updateNodeContent(doc, 0, 'Hello\n');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(result.kindChanged).toBe(true);
		expect(result.newKind).toBe('paragraph');
	});

	it('preserves leading trivia and ID position', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		updateNodeContent(doc, 1, 'Changed\n');
		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(doc.children[1].raw).toBe('Changed\n');
	});

	it('handles empty string content without crashing', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const result = updateNodeContent(doc, 0, '');
		expect(doc.children[0].raw).toBe('');
		expect(doc.children[0].kind).toBe('paragraph');
	});

	it('with multi-block content uses only first block kind', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const result = updateNodeContent(doc, 0, '# Heading\n\nParagraph\n');
		// The raw is stored as-is (the full multi-block text)
		expect(doc.children[0].raw).toBe('# Heading\n\nParagraph\n');
		// But kind is determined by re-parsing — only the first block matters
		expect(doc.children[0].kind).toBe('heading');
		// Document still has 1 child (updateNodeContent doesn't split)
		expect(doc.children).toHaveLength(1);
	});

	it('clears metadata when block type changes from heading to paragraph', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		expect(doc.children[0].metadata).toEqual({ level: 2 });
		updateNodeContent(doc, 0, 'Hello\n');
		expect(doc.children[0].metadata).toBeUndefined();
	});
});

describe('thematic break operations', () => {
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

describe('tree operations on arbitrary parent', () => {
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
