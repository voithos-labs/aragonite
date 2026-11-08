import { describe, it, expect } from 'vitest';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

/** Blank the field the rebuilder writes: a node built by the parser already holds the right
 *  bytes, so a rebuild that wrote nothing would pass silently. */
function cleared(node: CstNode): CstNode {
	node.raw = '';
	return node;
}

describe('the quote writer', () => {
	it.each([
		['a single paragraph', '> Hello\n'],
		['two paragraphs split by a blank quote line', '> Hello\n>\n> World\n'],
		['a multi-line paragraph', '> Line 1\n> Line 2\n'],
		['an empty paragraph', '>\n']
	])('re-emits a blockquote holding %s', (_case, source) => {
		const node = cleared(parse(source).children[0]);
		writeContainerRaw(node, defaultGrammarView);
		expect(node.raw).toBe(source);
	});
});

describe('the list item writer', () => {
	it.each([
		['a one-line paragraph', '- Item text\n'],
		['a multi-line paragraph indented to the marker', '- Line 1\n  Line 2\n'],
		['an ordered marker', '1. First\n'],
		['two paragraphs split by an unindented blank line', '- Para 1\n\n  Para 2\n'],
		['a nested list', '- Item\n  - Nested a\n  - Nested b\n']
	])('re-emits an item holding %s', (_case, source) => {
		const node = cleared(parse(source).children[0].children![0]);
		writeContainerRaw(node, defaultGrammarView);
		expect(node.raw).toBe(source);
	});
});

describe('rebuildListRaw', () => {
	it("concatenates each item's own bytes without descending into it", () => {
		const source = '- A\n- B\n';
		const list = cleared(parse(source).children[0]);
		// Grandchild left stale: the list rebuild reads item.raw, and callers rebuild
		// bottom-up, so a rebuilder that recursed would emit 'A2' here.
		list.children![0].children![0].raw = 'A2\n';

		rebuildListRaw(list);

		expect(list.raw).toBe(source);
	});
});

// Both kinds open their body on the container's own first line, so a rebuild ignores `innerPrefix`.
// Miss-analysis: GH #76; every rebuilder case built its node with `innerPrefix` already empty.
describe('the wrap-less rebuilders ignore innerPrefix', () => {
	it.each([
		['blockquote', '> quoted\n', (n: CstNode) => writeContainerRaw(n, defaultGrammarView)],
		['listItem', '- item\n', (n: CstNode) => writeContainerRaw(n, defaultGrammarView)]
	] as const)('%s re-emits its own bytes with a stray slot filled', (_kind, source, rebuild) => {
		const top = parse(source).children[0];
		const node = cleared(top.kind === 'list' ? top.children![0] : top);

		node.innerPrefix = '\n';
		rebuild(node);

		expect(node.raw).toBe(source);
	});
});

describe('parse + rebuild round-trip', () => {
	it('parse nested list then rebuild preserves raw', () => {
		const source = '- Item 1\n  - Nested\n- Item 2\n';
		const doc = parse(source);
		const list = cleared(doc.children[0]);
		const item1 = cleared(list.children![0]);

		writeContainerRaw(item1, defaultGrammarView);
		rebuildListRaw(list);

		expect(serialize(doc)).toBe(source);
	});
});

describe('the list item writer: task items', () => {
	it.each([
		['the marker between the list marker and the content', '- [x] hello\n'],
		['an uppercase X', '- [X] upper\n'],
		['the extra space after the box', '- [x]  extra\n'],
		['no task fragment at all on a plain item', '- plain\n']
	])('re-emits %s', (_case, source) => {
		const item = cleared(parse(source).children[0].children![0]);

		writeContainerRaw(item, defaultGrammarView);

		expect(item.raw).toBe(source);
	});
});
