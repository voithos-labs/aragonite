import { describe, it, expect } from 'vitest';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw
} from '../../schema/container-rebuilders';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

describe('rebuildBlockquoteRaw', () => {
	it('rebuilds single paragraph blockquote', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' }],
			innerSuffix: ''
		};
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> Hello\n');
	});

	it('rebuilds multi-paragraph blockquote with blank line', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			innerPrefix: '',
			children: [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' },
				{ kind: 'paragraph', leadingTrivia: '\n', raw: 'World\n' }
			],
			innerSuffix: ''
		};
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> Hello\n>\n> World\n');
	});

	it('handles multi-line paragraph inside blockquote', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Line 1\nLine 2\n' }],
			innerSuffix: ''
		};
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> Line 1\n> Line 2\n');
	});

	it('handles empty paragraph inside blockquote', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
			metadata: { quoteDepth: 1 },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
			innerSuffix: ''
		};
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('>\n');
	});
});

describe('rebuildListItemRaw', () => {
	it('rebuilds simple list item', () => {
		const node: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Item text\n' }],
			innerSuffix: ''
		};
		rebuildListItemRaw(node);
		expect(node.raw).toBe('- Item text\n');
	});

	it('rebuilds list item with multi-line paragraph', () => {
		const node: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Line 1\nLine 2\n' }],
			innerSuffix: ''
		};
		rebuildListItemRaw(node);
		expect(node.raw).toBe('- Line 1\n  Line 2\n');
	});

	it('rebuilds ordered list item', () => {
		const node: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '1. ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'First\n' }],
			innerSuffix: ''
		};
		rebuildListItemRaw(node);
		expect(node.raw).toBe('1. First\n');
	});

	it('rebuilds list item with two paragraphs separated by blank line', () => {
		const node: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'Para 1\n' },
				{ kind: 'paragraph', leadingTrivia: '\n', raw: 'Para 2\n' }
			],
			innerSuffix: ''
		};
		rebuildListItemRaw(node);
		expect(node.raw).toBe('- Para 1\n\n  Para 2\n');
	});
});

describe('rebuildListRaw', () => {
	it('rebuilds list from items', () => {
		const item1: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- A\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [],
			innerSuffix: ''
		};
		const item2: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- B\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [],
			innerSuffix: ''
		};
		const node: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw: '',
			metadata: { ordered: false },
			innerPrefix: '',
			children: [item1, item2],
			innerSuffix: ''
		};
		rebuildListRaw(node);
		expect(node.raw).toBe('- A\n- B\n');
	});
});

describe('rebuildListItemRaw: nested content', () => {
	it('rebuilds item with nested list', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			children: [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'Item\n' },
				{
					kind: 'list',
					leadingTrivia: '',
					raw: '- Nested a\n- Nested b\n',
					metadata: { ordered: false },
					innerPrefix: '',
					children: [],
					innerSuffix: ''
				}
			],
			innerSuffix: ''
		};
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- Item\n  - Nested a\n  - Nested b\n');
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
		const node = top.kind === 'list' ? top.children![0] : top;

		node.innerPrefix = '\n';
		rebuild(node);

		expect(node.raw).toBe(source);
	});
});

describe('parse + rebuild round-trip', () => {
	it('parse nested list then rebuild preserves raw', () => {
		const source = '- Item 1\n  - Nested\n- Item 2\n';
		const doc = parse(source);
		const list = doc.children[0];
		const item1 = list.children![0];

		rebuildListItemRaw(item1);
		rebuildListRaw(list);

		expect(serialize(doc)).toBe(source);
	});
});

describe('rebuildListItemRaw: task items', () => {
	it('emits taskMarker between list marker and content', () => {
		const doc = parse('- [x] hello\n');
		const item = doc.children[0].children![0];

		rebuildListItemRaw(item);

		expect(item.raw).toBe('- [x] hello\n');
	});

	it('preserves uppercase X across rebuild', () => {
		const doc = parse('- [X] upper\n');
		const item = doc.children[0].children![0];

		rebuildListItemRaw(item);

		expect(item.raw).toBe('- [X] upper\n');
	});

	it('preserves multi-space across rebuild', () => {
		const doc = parse('- [x]  extra\n');
		const item = doc.children[0].children![0];

		rebuildListItemRaw(item);

		expect(item.raw).toBe('- [x]  extra\n');
	});

	it('non-task list item rebuild emits no task fragment', () => {
		const doc = parse('- plain\n');
		const item = doc.children[0].children![0];

		rebuildListItemRaw(item);

		expect(item.raw).toBe('- plain\n');
	});
});
