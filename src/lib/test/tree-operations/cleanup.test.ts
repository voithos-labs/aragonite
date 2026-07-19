import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { assignIds } from '../../block-id';
import { cascadeCleanupEmptyAncestors } from '../../tree-operations/cleanup';
import type { CstNode, Document } from '../../core/nodes';

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function bq(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		children,
		innerPrefix: '',
		innerSuffix: ''
	};
}

function doc(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}

describe('cascadeCleanupEmptyAncestors', () => {
	it('removes an empty blockquote at the top level', () => {
		const d = doc([bq([]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], []);
		expect(d.children).toHaveLength(1);
		expect(d.children[0].kind).toBe('paragraph');
	});

	it('leaves a non-empty blockquote alone', () => {
		const d = doc([bq([para('b\n')]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], []);
		expect(d.children).toHaveLength(2);
		expect(d.children[0].children).toHaveLength(1);
	});

	it('cascades through nested empty containers', () => {
		const d = doc([bq([bq([])])]);
		cascadeCleanupEmptyAncestors(d, [0, 0, 0], []);
		expect(d.children).toHaveLength(0);
	});

	it('stops walking at the lca', () => {
		const d1 = doc([bq([]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d1, [0, 0], [0]);
		expect(d1.children).toHaveLength(2);
	});

	it('keeps a surviving ancestor childIds aligned when an emptied container is removed', () => {
		// blockquote containing a paragraph and a list; empty the list and clean up.
		const d = parse('> para\n>\n> - item\n');
		const quote = d.children[0];
		quote.childIds = assignIds(quote.children!);
		const list = quote.children![1];
		list.children = [];
		cascadeCleanupEmptyAncestors(d, [0, 1, 0], []);
		expect(quote.children!.length).toBe(1);
		expect(quote.childIds.length).toBe(quote.children!.length);
	});
});
