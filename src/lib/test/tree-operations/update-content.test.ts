import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { deleteNode, updateNodeContent } from '../../tree-operations';

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

describe('deleteNode', () => {
	it('removes the node at the given index', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const ids = ['id-1', 'id-2', 'id-3'];
		const change = deleteNode(doc, 1);
		expect(change).toEqual({ op: 'delete', at: 1, count: 1 });
		if (change.op !== 'delete') throw new Error('expected delete');
		ids.splice(change.at, change.count);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('A\n');
		expect(doc.children[1].raw).toBe('C\n');
		expect(ids).toEqual(['id-1', 'id-3']);
	});

	it('transfers leading trivia to the next block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		const triviaB = doc.children[1].leadingTrivia;
		const triviaC = doc.children[2].leadingTrivia;
		deleteNode(doc, 1);
		expect(doc.children[1].leadingTrivia).toBe(triviaB + triviaC);
	});
});

describe('deleteNode edge cases', () => {
	it('deleting the only node leaves empty document', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const ids = ['id-1'];
		const change = deleteNode(doc, 0);
		if (change.op !== 'delete') throw new Error('expected delete');
		ids.splice(change.at, change.count);
		expect(doc.children).toHaveLength(0);
		expect(ids).toHaveLength(0);
	});

	it('deleting the first node transfers trivia correctly', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		deleteNode(doc, 0);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('B\n');
	});

	it('deleting the last node does not crash', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		deleteNode(doc, 1);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].raw).toBe('A\n');
	});

	it('returns noop for out-of-bounds index', () => {
		const source = 'A\n';
		const doc = parse(source);
		const change = deleteNode(doc, 5);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(1);
	});
});
