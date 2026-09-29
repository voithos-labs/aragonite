import { describe, it, expect } from 'vitest';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { parse } from '../../core/parser';
import { assignIds } from '../../block-id';
import { cascadeCleanupEmptyAncestors } from '../../tree-operations/cleanup';
import { createSharingState } from '../../tree-operations/sharing';
import type { CstNode, Document } from '../../core/nodes';
import { defaultGrammarView } from '$lib/schema/block-openers';

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
	// The walk splices at any depth, so it copies the ancestors itself: without the copy the
	// splice lands on a node an undo entry still references.
	it('unshares the ancestor chain instead of splicing through a snapshot-shared parent', () => {
		const sharing = createSharingState();
		const d = parse('> para\n>\n> - item\n');
		const sharedQuote = d.children[0];
		sharedQuote.children![1].children = [];
		sharing.markSnapshotTaken();

		cascadeCleanupEmptyAncestors(d, [0, 1, 0], sharing, defaultGrammarView);

		expect(d.children[0]).not.toBe(sharedQuote);
		expect(d.children[0].children).toHaveLength(1);
		expect(sharedQuote.children).toHaveLength(2);
	});

	it('removes an empty blockquote at the top level', () => {
		const d = doc([bq([]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], createSharingState(), defaultGrammarView);
		expect(d.children).toHaveLength(1);
		expect(d.children[0].kind).toBe('paragraph');
	});

	it('leaves a non-empty blockquote alone', () => {
		const d = doc([bq([para('b\n')]), para('x\n')]);
		cascadeCleanupEmptyAncestors(d, [0, 0], createSharingState(), defaultGrammarView);
		expect(d.children).toHaveLength(2);
		expect(d.children[0].children).toHaveLength(1);
	});

	it('cascades through nested empty containers', () => {
		const d = doc([bq([bq([])])]);
		cascadeCleanupEmptyAncestors(d, [0, 0, 0], createSharingState(), defaultGrammarView);
		expect(d.children).toHaveLength(0);
	});

	it('never splices the root, even when it empties', () => {
		const root = bq([bq([])]);
		cascadeCleanupEmptyAncestors(root, [0, 0], createSharingState(), defaultGrammarView);
		expect(root.children).toHaveLength(0);
	});

	it('walks from a container root as from the document', () => {
		const root = bq([para('a\n'), bq([])]);
		cascadeCleanupEmptyAncestors(root, [1, 0], createSharingState(), defaultGrammarView);
		expect(root.children!.map((c) => c.kind)).toEqual(['paragraph']);
	});

	it('spares a whole-block kind and a leaf, which hold no child by design', () => {
		registerMermaidKind();
		const diagram = parse('```mermaid\ngraph TD\n```\n').children[0];
		expect(diagram.kind).toBe('mermaid');
		const leaf = { ...para('x\n'), children: [] } as CstNode;
		const d = doc([diagram, leaf]);
		cascadeCleanupEmptyAncestors(d, [0, 0], createSharingState(), defaultGrammarView);
		cascadeCleanupEmptyAncestors(d, [1, 0], createSharingState(), defaultGrammarView);
		expect(d.children).toEqual([diagram, leaf]);
	});

	it('keeps a surviving ancestor childIds aligned when an emptied container is removed', () => {
		const d = parse('> para\n>\n> - item\n');
		const quote = d.children[0];
		quote.childIds = assignIds(quote.children!);
		const list = quote.children![1];
		list.children = [];
		cascadeCleanupEmptyAncestors(d, [0, 1, 0], createSharingState(), defaultGrammarView);
		expect(quote.children!.length).toBe(1);
		expect(quote.childIds.length).toBe(quote.children!.length);
	});
});
