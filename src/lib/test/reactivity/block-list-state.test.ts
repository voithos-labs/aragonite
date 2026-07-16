import { describe, it, expect } from 'vitest';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { CstNode } from '../../core/nodes';

function makeNode(children: CstNode[]): CstNode {
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

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

describe('createBlockListState', () => {
	it('seeds innerBlockIds to one unique id per child', () => {
		const node = makeNode([makePara('a\n'), makePara('b\n'), makePara('c\n')]);
		const state = createBlockListState(() => node);
		expect(state.innerBlockIds).toHaveLength(3);
		expect(new Set(state.innerBlockIds).size).toBe(3);
	});

	it('seeds innerBlockRefs as an empty array', () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		expect(state.innerBlockRefs).toEqual([]);
	});
});
