import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { mergeWithPrevious } from '../tree-operations';

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

describe('heading merge operations', () => {
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
