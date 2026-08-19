import { describe, it, expect } from 'vitest';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw
} from '../../schema/container-rebuilders';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

/** Blank the slot the rebuilder writes: a parse-built node arrives with the right bytes
 *  already there, so a rebuild that wrote nothing would pass silently. */
function cleared(node: CstNode): CstNode {
	node.raw = '';
	return node;
}

describe('rebuildBlockquoteRaw', () => {
	it.each([
		['a single paragraph', '> Hello\n'],
		['two paragraphs split by a blank quote line', '> Hello\n>\n> World\n'],
		['a multi-line paragraph', '> Line 1\n> Line 2\n'],
		['an empty paragraph', '>\n']
	])('re-emits a blockquote holding %s', (_case, source) => {
		const node = cleared(parse(source).children[0]);
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe(source);
	});
});

describe('rebuildListItemRaw', () => {
	it.each([
		['a one-line paragraph', '- Item text\n'],
		['a multi-line paragraph indented to the marker', '- Line 1\n  Line 2\n'],
		['an ordered marker', '1. First\n'],
		['two paragraphs split by an unindented blank line', '- Para 1\n\n  Para 2\n'],
		['a nested list', '- Item\n  - Nested a\n  - Nested b\n']
	])('re-emits an item holding %s', (_case, source) => {
		const node = cleared(parse(source).children[0].children![0]);
		rebuildListItemRaw(node);
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

// GH #76: both kinds open their body on the container's own first line, so `innerPrefix` is
// pinned empty and honoring it emitted an opener line no parse produces ('- item' rebuilding
// to '- \n  item'). Miss-analysis: every rebuilder case built its node with the slot already
// empty, so the arm reading it was reachable only from a hand-built node no test wrote.
describe('the wrap-less rebuilders ignore innerPrefix', () => {
	it.each([
		['blockquote', '> quoted\n', (n: CstNode) => rebuildBlockquoteRaw(n)],
		['listItem', '- item\n', (n: CstNode) => rebuildListItemRaw(n)]
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

		rebuildListItemRaw(item1);
		rebuildListRaw(list);

		expect(serialize(doc)).toBe(source);
	});
});

describe('rebuildListItemRaw: task items', () => {
	it.each([
		['the marker between the list marker and the content', '- [x] hello\n'],
		['an uppercase X', '- [X] upper\n'],
		['the extra space after the box', '- [x]  extra\n'],
		['no task fragment at all on a plain item', '- plain\n']
	])('re-emits %s', (_case, source) => {
		const item = cleared(parse(source).children[0].children![0]);

		rebuildListItemRaw(item);

		expect(item.raw).toBe(source);
	});
});
