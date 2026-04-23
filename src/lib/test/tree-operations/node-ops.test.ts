import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { ensureEditableContainers } from '../../tree-operations/node-ops';
import { rebuildListItemRaw, rebuildBlockquoteRaw } from '../../tree-operations/container-raw';
import type { CstNode } from '../../core/nodes';

describe('ensureEditableContainers', () => {
	it('backfills an empty container with a paragraph child', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.children).toHaveLength(1);
		expect(item.children![0].kind).toBe('paragraph');
		expect(item.children![0].raw).toBe('\n');
	});

	it('clears innerPrefix when backfilling — backfilled paragraph subsumes the trailing-newline role', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.innerPrefix).toBe('');
	});

	it('leaves innerPrefix alone for non-empty containers', () => {
		const item: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '- \n  Hello\n',
			metadata: { marker: '- ', taskItem: false, taskChecked: false },
			innerPrefix: '\n',
			children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'Hello\n' }],
			innerSuffix: ''
		};
		ensureEditableContainers(item);
		expect(item.innerPrefix).toBe('\n');
		expect(item.children).toHaveLength(1);
	});

	it('clears innerPrefix on backfilled blockquote too', () => {
		const bq: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '>\n',
			metadata: { quoteDepth: 1 },
			innerPrefix: '\n',
			children: [],
			innerSuffix: ''
		};
		ensureEditableContainers(bq);
		expect(bq.innerPrefix).toBe('');
		expect(bq.children).toHaveLength(1);
	});
});

describe('parse + backfill + edit + rebuild — round-trip after empty-item edit', () => {
	it('typing into a backfilled empty list item produces the expected raw', () => {
		const doc = parse('- \n');
		const list = doc.children[0];
		const item = list.children![0];
		ensureEditableContainers(item);

		// Simulate the edit pipeline: the synthesized paragraph receives content,
		// then the container's raw is rebuilt from children.
		item.children![0].raw = 'X\n';
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- X\n');
	});

	it('typing into a backfilled empty blockquote produces the expected raw', () => {
		const doc = parse('>\n');
		const bq = doc.children[0];
		ensureEditableContainers(bq);

		bq.children![0].raw = 'X\n';
		rebuildBlockquoteRaw(bq);
		expect(bq.raw).toBe('> X\n');
	});
});
