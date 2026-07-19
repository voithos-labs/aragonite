import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { getInlineContent } from '../../core/inline/inline-cache';
import type { CstNode } from '../../core/nodes';
import { deleteNode, updateNodeContent } from '../../tree-operations';
import { replacePreservingFirst } from '../../tree-operations/structural-change';

describe('updateNodeContent', () => {
	it('updates the raw text of a node', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const change = updateNodeContent(doc, 0, 'World\n');
		expect(doc.children[0].raw).toBe('World\n');
		expect(change).toEqual({ op: 'noop' });
	});

	// The same-kind path writes in place: routine typing must keep the node object,
	// since the component instance, IME state, and the inline-cache WeakMap are all
	// keyed on it. A mint-always refactor keeps raw/metadata and the noop return but
	// silently breaks this — the covering tests above stay green, so pin it directly.
	it('same-kind edit preserves the node object identity', () => {
		const doc = parse('Hello\n');
		const before = doc.children[0];
		updateNodeContent(doc, 0, 'edited\n');
		expect(doc.children[0]).toBe(before);
	});

	it('kind change swaps the node object (mint-and-replace)', () => {
		const doc = parse('Hello\n');
		const before = doc.children[0];
		updateNodeContent(doc, 0, '## edited\n');
		expect(doc.children[0]).not.toBe(before);
	});

	it('kind change from paragraph to heading returns a same-slot replace', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const change = updateNodeContent(doc, 0, '## Hello\n');
		expect(doc.children[0].kind).toBe('heading');
		expect(doc.children[0].metadata).toEqual({ level: 2 });
		expect(change).toEqual(replacePreservingFirst(0, 1, 1));
	});

	it('kind change from heading to paragraph returns a same-slot replace', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		const change = updateNodeContent(doc, 0, 'Hello\n');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(change).toEqual(replacePreservingFirst(0, 1, 1));
	});

	it('replace window tracks the block index', () => {
		const source = 'A\n\nB\n';
		const doc = parse(source);
		const change = updateNodeContent(doc, 1, '# B\n');
		expect(change).toEqual(replacePreservingFirst(1, 1, 1));
	});

	it('tableCell update writes raw only and returns noop', () => {
		const cell: CstNode = { kind: 'tableCell', leadingTrivia: '', raw: 'a' };
		const change = updateNodeContent({ children: [cell] }, 0, 'ab');
		expect(change).toEqual({ op: 'noop' });
		expect(cell.raw).toBe('ab');
		expect(cell.kind).toBe('tableCell');
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
		const change = updateNodeContent(doc, 0, '');
		expect(doc.children[0].raw).toBe('');
		expect(doc.children[0].kind).toBe('paragraph');
		expect(change).toEqual({ op: 'noop' });
	});

	it('multi-block content splits into sibling blocks (kind change on first)', () => {
		const source = 'Hello\n';
		const doc = parse(source);
		const change = updateNodeContent(doc, 0, '# Heading\n\nParagraph\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph']);
		expect(doc.children[0].raw).toBe('# Heading\n');
		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(doc.children[1].raw).toBe('Paragraph\n');
		expect(change).toEqual(replacePreservingFirst(0, 1, 2));
	});

	// The stuck-fence class: an edit appending past a verbatim fence must split
	// into fence + paragraph, not cram both into the fence node (a same-kind
	// reparse used to be a raw-only write, leaving the CST disagreeing with
	// parse(serialize(doc))).
	it('same-kind multi-block content splits instead of cramming (fence + trailing paragraph)', () => {
		const doc = parse('```\nx\n```\n');
		const edited = '```\nx\n```\n\nhello\n';
		const change = updateNodeContent(doc, 0, edited);
		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode', 'paragraph']);
		expect(doc.children[0].raw).toBe('```\nx\n```\n');
		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(doc.children[1].raw).toBe('hello\n');
		expect(change).toEqual(replacePreservingFirst(0, 1, 2));
		expect(serialize(doc)).toBe(edited);
	});

	it('paragraph edit whose second line interrupts splits (hard break + heading)', () => {
		const doc = parse('foo\n');
		const change = updateNodeContent(doc, 0, 'foo\\\n# bar\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading']);
		expect(doc.children[0].raw).toBe('foo\\\n');
		expect(doc.children[1].raw).toBe('# bar\n');
		expect(change).toEqual(replacePreservingFirst(0, 1, 2));
	});

	it('multi-block split preserves the original leading trivia on the first block', () => {
		const doc = parse('A\n\nB\n');
		updateNodeContent(doc, 1, 'B\n\nC\n');
		expect(doc.children[1].leadingTrivia).toBe('\n');
		expect(serialize(doc)).toBe('A\n\nB\n\nC\n');
	});

	it('clears metadata when block type changes from heading to paragraph', () => {
		const source = '## Hello\n';
		const doc = parse(source);
		expect(doc.children[0].metadata).toEqual({ level: 2 });
		updateNodeContent(doc, 0, 'Hello\n');
		expect(doc.children[0].metadata).toBeUndefined();
	});

	it('exposes fresh inlines via the lazy accessor after an edit (validate-on-read)', () => {
		const source = '![pic](/sample.png)\n';
		const doc = parse(source);
		// Pre-edit: image-only inline tree.
		expect(getInlineContent(doc.children[0]).map((n) => n.kind)).toEqual(['image']);

		updateNodeContent(doc, 0, '![pic](/sample.png)a\n');

		// raw changed in place → the accessor recomputes rather than returning the cached image-only tree.
		const inlines = getInlineContent(doc.children[0]);
		expect(inlines.map((n) => n.kind)).toEqual(['image', 'text']);
		expect(inlines[1].text).toBe('a');
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
