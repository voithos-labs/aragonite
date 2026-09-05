import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { mergeIntoPrevDeepLeaf, mergeWithNext } from '../../tree-operations';
import { applyStructuralChangeToIdsRefs } from '../../tree-operations/structural-change';

// The two joins production reaches: the forward reparse sink, and the backward deep-leaf write.

describe('mergeIntoPrevDeepLeaf', () => {
	it('merges two paragraphs into one (strips internal line break)', () => {
		const doc = parse('Hello\n\nWorld\n');
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the first block ID and removes the second', () => {
		const doc = parse('Hello\n\nWorld\n');
		const ids = ['keep-me', 'remove-me'];
		const result = mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
		expect(result?.change).toEqual({ op: 'delete', at: 1, count: 1 });
		applyStructuralChangeToIdsRefs(result!.change, ids, [undefined, undefined]);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the first block', () => {
		const doc = parse('A\n\nB\n\nC\n');
		mergeIntoPrevDeepLeaf(doc, 2, undefined, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('declines at index 0 and past the tail, leaving the tree alone', () => {
		const doc = parse('Hello\n\nWorld\n');
		expect(mergeIntoPrevDeepLeaf(doc, 0, undefined, undefined, undefined)).toBeNull();
		expect(mergeIntoPrevDeepLeaf(doc, 5, undefined, undefined, undefined)).toBeNull();
		expect(doc.children).toHaveLength(2);
	});

	// The write re-reads its own bytes, so absorbed marker text re-kinds the slot it lands in.
	it('re-reads the merged bytes to determine the surviving block type', () => {
		const doc = parse('');
		doc.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Title\n');
	});

	it('merges a paragraph into the heading above it', () => {
		const doc = parse('');
		doc.children = [
			{ kind: 'heading', leadingTrivia: '', raw: '## Hello\n', metadata: { level: 2 } },
			{ kind: 'paragraph', leadingTrivia: '', raw: ' World\n' }
		];
		mergeIntoPrevDeepLeaf(doc, 1, undefined, undefined, undefined);
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
		mergeWithNext(doc, 0, undefined, undefined);
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('HelloWorld\n');
	});

	it('preserves the current block ID and removes the next', () => {
		const source = 'Hello\n\nWorld\n';
		const doc = parse(source);
		const ids = ['keep-me', 'remove-me'];
		const { change } = mergeWithNext(doc, 0, undefined, undefined);
		expect(change).toEqual({ op: 'replace', at: 0, count: 2, newCount: 1, idMap: { 0: 0 } });
		applyStructuralChangeToIdsRefs(change, ids, [undefined, undefined]);
		expect(ids).toEqual(['keep-me']);
	});

	it('preserves leading trivia of the current block', () => {
		const source = 'A\n\nB\n\nC\n';
		const doc = parse(source);
		mergeWithNext(doc, 1, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('returns noop when blockIndex is the last block', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const { change } = mergeWithNext(doc, 0, undefined, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(1);
	});

	it('re-parses to determine merged block type', () => {
		const doc = parse('');

		doc.children = [
			{ kind: 'paragraph', leadingTrivia: '', raw: '## ' },
			{ kind: 'paragraph', leadingTrivia: '', raw: 'Title\n' }
		];
		mergeWithNext(doc, 0, undefined, undefined);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Title\n');
	});
});

describe('mergeWithNext edge cases', () => {
	it('returns noop when blockIndex is out of bounds', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const { change } = mergeWithNext(doc, 5, undefined, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(2);
	});

	it('returns noop when blockIndex is negative', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const { change } = mergeWithNext(doc, -1, undefined, undefined);
		expect(change).toEqual({ op: 'noop' });
		expect(doc.children).toHaveLength(2);
	});
});
