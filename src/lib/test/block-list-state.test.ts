import { describe, it, expect } from 'vitest';
import { createBlockListState } from '../container-state/block-list-state.svelte';
import type { CstNode } from '../core/nodes';

function makeNode(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
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
		const state = createBlockListState(node);
		expect(state.innerBlockIds).toHaveLength(3);
		expect(new Set(state.innerBlockIds).size).toBe(3);
	});

	it('seeds innerBlockRefs as an empty array', () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(node);
		expect(state.innerBlockRefs).toEqual([]);
	});

	it('commitChildrenEdit appends a child atomically', () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(node);
		const originalIds = [...state.innerBlockIds];

		state.commitChildrenEdit((children, ids, refs) => {
			children.push(makePara('b\n'));
			ids.push('new-id');
			refs.push(undefined);
		});

		expect(node.children).toHaveLength(2);
		expect(node.children![1].raw).toBe('b\n');
		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockIds[1]).toBe('new-id');
		expect(state.innerBlockIds[0]).toBe(originalIds[0]);
	});

	it('commitChildrenEdit splices a child out atomically', () => {
		const node = makeNode([makePara('a\n'), makePara('b\n'), makePara('c\n')]);
		const state = createBlockListState(node);
		const idsBefore = [...state.innerBlockIds];

		state.commitChildrenEdit((children, ids, refs) => {
			children.splice(1, 1);
			ids.splice(1, 1);
			refs.splice(1, 1);
		});

		expect(node.children).toHaveLength(2);
		expect(node.children![0].raw).toBe('a\n');
		expect(node.children![1].raw).toBe('c\n');
		expect(state.innerBlockIds[0]).toBe(idsBefore[0]);
		expect(state.innerBlockIds[1]).toBe(idsBefore[2]);
	});

	it('commitChildrenEdit callback receives plain-array copies, not the state proxies', () => {
		const node = makeNode([makePara('a\n'), makePara('b\n')]);
		const state = createBlockListState(node);
		const originalChildren = node.children;

		state.commitChildrenEdit((children, ids, refs) => {
			expect(children).not.toBe(originalChildren);
			children.push(makePara('c\n'));
		});

		expect(node.children).toHaveLength(3);
	});

	it('triggerReactivity re-spreads children and ids without changing length', () => {
		const node = makeNode([makePara('a\n'), makePara('b\n')]);
		const state = createBlockListState(node);
		const idsBefore = state.innerBlockIds;
		const childrenBefore = node.children;

		state.triggerReactivity();

		expect(state.innerBlockIds).not.toBe(idsBefore);
		expect(state.innerBlockIds).toEqual(idsBefore);
		expect(node.children).not.toBe(childrenBefore);
		expect(node.children).toHaveLength(2);
	});
});
