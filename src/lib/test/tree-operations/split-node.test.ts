import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { applyStructuralChangeToIdsRefs } from '../../tree-operations/structural-change';
import { takeDevWarns } from '$lib/test/support/warn-gate';

describe('splitNode', () => {
	it('splits a paragraph into two paragraphs', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const { change, secondHalfIndex } = splitNode(doc, 0, 5, undefined, undefined, undefined);
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } });
		expect(secondHalfIndex).toBe(1);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].raw).toBe(' World\n');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(serialize(doc)).toBe('Hello\n\n World\n');
	});

	it('preserves the original ID and assigns a new one', () => {
		const source = 'Hello World\n';
		const doc = parse(source);
		const ids = ['original-id'];
		const { change } = splitNode(doc, 0, 5, undefined, undefined, undefined);
		applyStructuralChangeToIdsRefs(change, ids, [undefined]);
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe('original-id');
		expect(ids[1]).not.toBe('original-id');
	});

	it('splits at the beginning creates empty first paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		splitNode(doc, 0, 0, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('\n');
		expect(doc.children[1].raw).toBe('Hello\n');
	});

	it('splits at the end creates empty second paragraph', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		splitNode(doc, 0, 5, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('\n');
	});

	it('preserves leading trivia on the first block when splitting a non-first block', () => {
		const source = 'First\n\nSecond\n';
		const doc = parse(source);
		splitNode(doc, 1, 3, undefined, undefined, undefined);
		expect(doc.children[1].leadingTrivia).toBe('\n');
	});

	it('handles multi-line paragraph split', () => {
		const source = 'Line one.\nLine two.\n';
		const doc = parse(source);
		splitNode(doc, 0, 10, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Line one.\n');
		expect(doc.children[1].raw).toBe('Line two.\n');
	});

	it('handles CRLF line endings correctly', () => {
		const source = 'Hello World\r\n';
		const doc = parse(source);
		splitNode(doc, 0, 5, undefined, undefined, undefined);
		expect(doc.children[0].raw).toBe('Hello\r\n');
		expect(doc.children[1].raw).toBe(' World\r\n');
	});
});

describe('splitNode edge cases', () => {
	// GH #98: the caret contract is the returned index, not `blockIndex + 1` — a first half
	// whose bytes reparse plural (blank lines inside indented code) pushes the second half down.
	it('reports the second half index past a plural first half', () => {
		const doc = parse('    a\n\n\n    b\n');
		const { secondHalfIndex } = splitNode(doc, 0, 7, undefined, undefined, undefined);
		expect(secondHalfIndex).toBe(2);
		expect(doc.children[secondHalfIndex].raw).toBe('    b\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['tree-ops']);
	});

	it('split at offset beyond raw length produces empty second block', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		splitNode(doc, 0, 100, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].raw).toBe('Hello\n');
		expect(doc.children[1].raw).toBe('\n');
	});
});

describe('heading split operations', () => {
	it('splits a heading into heading + paragraph', () => {
		const source = '## Hello World\n';
		const doc = parse(source);
		splitNode(doc, 0, 8, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].raw).toBe('## Hello\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe(' World\n');
	});

	it('splits a heading at start produces empty paragraph + heading', () => {
		const source = '## Title\n';
		const doc = parse(source);
		splitNode(doc, 0, 0, undefined, undefined, undefined);
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
		splitNode(doc, 0, 3, undefined, undefined, undefined);
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('thematicBreak');
		expect(doc.children[0].raw).toBe('---\n');
		expect(doc.children[1].kind).toBe('paragraph');
		expect(doc.children[1].raw).toBe('\n');
	});
});

// The setext-suffix split (underline retention, trailing-whitespace cuts) lives in
// setext-split.test.ts.

describe('splitNode on arbitrary parent', () => {
	it('splitNode works on a container children array', () => {
		const parent = {
			children: [{ kind: 'paragraph' as const, leadingTrivia: '', raw: 'Hello World\n' }],
			ownerKind: undefined,
			owner: undefined
		};
		splitNode(parent, 0, 5, undefined, undefined, undefined);
		expect(parent.children).toHaveLength(2);
		expect(parent.children[0].raw).toBe('Hello\n');
		expect(parent.children[1].raw).toBe(' World\n');
	});
});
