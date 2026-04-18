// src/lib/editor/test/container-raw.test.ts
import { describe, it, expect } from 'vitest';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw
} from '../../tree-operations/container-raw';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';

describe('rebuildBlockquoteRaw', () => {
	it('rebuilds single paragraph blockquote', () => {
		const node: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '',
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
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
			innerSuffix: ''
		};
		rebuildBlockquoteRaw(node);
		// An empty line inside a blockquote is just '>' (blank prefix, no content)
		expect(node.raw).toBe('>\n');
	});
});

describe('rebuildListItemRaw', () => {
	it('rebuilds simple list item', () => {
		const node: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
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
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
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
			metadata: { marker: '1. ', taskItem: false, taskChecked: false },
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
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '',
			children: [
				{ kind: 'paragraph', leadingTrivia: '', raw: 'Para 1\n' },
				{ kind: 'paragraph', leadingTrivia: '\n', raw: 'Para 2\n' }
			],
			innerSuffix: ''
		};
		rebuildListItemRaw(node);
		// Blank line between paragraphs in a list item is preserved as
		// an empty line (no indent). The GFM spec treats this as a "loose"
		// list item where paragraphs are separated by blank lines.
		expect(node.raw).toBe('- Para 1\n\n  Para 2\n');
	});
});

describe('rebuildListRaw', () => {
	it('rebuilds list from items', () => {
		const item1: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- A\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '',
			children: [],
			innerSuffix: ''
		};
		const item2: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- B\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
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
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
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

	it('rebuilds item with continuation paragraph', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Line 1\nLine 2\n' }],
			innerSuffix: ''
		};
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- Line 1\n  Line 2\n');
	});
});

describe('parse + rebuild round-trip', () => {
	it('parse nested list then rebuild preserves raw', () => {
		const source = '- Item 1\n  - Nested\n- Item 2\n';
		const doc = parse(source);
		const list = doc.children[0];
		const item1 = list.children![0];

		// Rebuild item 1 raw from its children
		rebuildListItemRaw(item1);
		// Rebuild list raw from its items
		rebuildListRaw(list);

		expect(serialize(doc)).toBe(source);
	});
});
