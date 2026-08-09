import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { mergeWithPrevious, mergeWithNext } from '../../tree-operations';
import { applyStructuralChangeToIdsRefs } from '../../tree-operations/structural-change';

describe('mergeWithPrevious', () => {
	it('merges two paragraphs into one (strips internal line break)', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		mergeWithPrevious(doc, 1, undefined);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the first block ID and removes the second', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const ids = ['keep-me', 'remove-me'];
		const change = mergeWithPrevious(doc, 1, undefined);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
		applyStructuralChangeToIdsRefs(change, ids, [undefined, undefined]);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the first block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		mergeWithPrevious(doc, 2, undefined);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('returns noop when blockIndex is 0', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const change = mergeWithPrevious(doc, 0, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(1);
	});

	it('re-parses to determine merged block type', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		mergeWithPrevious(doc, 1, undefined);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Title\n');
	});
});

describe('mergeWithPrevious edge cases', () => {
	it('returns noop when blockIndex is out of bounds', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const change = mergeWithPrevious(doc, 5, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(2);
	});
});

describe('heading merge operations', () => {
	it('merges heading + paragraph into heading', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'heading', leadingTrivia: '', raw: '## Hello\n', metadata: { level: 2 } },
			{ kind: 'paragraph', leadingTrivia: '', raw: ' World\n' }
		];
		mergeWithPrevious(doc, 1, undefined);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Hello World\n');
	});
});

// ── mergeWithNext ──────────────────────────────────────────────────────────

describe('mergeWithNext', () => {
	it('merges two paragraphs into one (strips internal line break)', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		mergeWithNext(doc, 0, undefined);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the current block ID and removes the next', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const ids = ['keep-me', 'remove-me'];
		const change = mergeWithNext(doc, 0, undefined);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
		applyStructuralChangeToIdsRefs(change, ids, [undefined, undefined]);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the current block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		mergeWithNext(doc, 1, undefined);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('returns noop when blockIndex is the last block', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const change = mergeWithNext(doc, 0, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(1);
	});

	it('re-parses to determine merged block type', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		mergeWithNext(doc, 0, undefined);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Title\n');
	});
});

describe('mergeWithNext edge cases', () => {
	it('returns noop when blockIndex is out of bounds', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const change = mergeWithNext(doc, 5, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(2);
	});

	it('returns noop when blockIndex is negative', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const change = mergeWithNext(doc, -1, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(2);
	});
});
