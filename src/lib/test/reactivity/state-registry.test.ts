import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	registerBlockListState,
	getStateForNode,
	expectStateForNode
} from '../../reactivity/state-registry';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import type { CstNode } from '../../core/nodes';

function makeFakeState(): BlockListState {
	return {
		innerBlockIds: [],
		innerBlockRefs: []
	};
}

function makeFakeNode(kind: CstNode['kind'] = 'list'): CstNode {
	return { kind, leadingTrivia: '', raw: '' } as CstNode;
}

describe('state-registry', () => {
	describe('registerBlockListState / getStateForNode', () => {
		it('resolves a registered state by node reference', () => {
			const node = makeFakeNode();
			const state = makeFakeState();
			registerBlockListState(node, state);
			expect(getStateForNode(node)).toBe(state);
		});

		it('returns undefined for an unregistered node', () => {
			const node = makeFakeNode();
			expect(getStateForNode(node)).toBeUndefined();
		});

		it('overwrites the existing entry on re-register', () => {
			const node = makeFakeNode();
			const first = makeFakeState();
			const second = makeFakeState();
			registerBlockListState(node, first);
			registerBlockListState(node, second);
			expect(getStateForNode(node)).toBe(second);
		});

		it('keeps entries for different nodes independent', () => {
			const nodeA = makeFakeNode('list');
			const nodeB = makeFakeNode('blockquote');
			const stateA = makeFakeState();
			const stateB = makeFakeState();
			registerBlockListState(nodeA, stateA);
			registerBlockListState(nodeB, stateB);
			expect(getStateForNode(nodeA)).toBe(stateA);
			expect(getStateForNode(nodeB)).toBe(stateB);
		});
	});

	describe('expectStateForNode', () => {
		it('returns the registered state when present', () => {
			const node = makeFakeNode();
			const state = makeFakeState();
			registerBlockListState(node, state);
			expect(expectStateForNode(node)).toBe(state);
		});

		it('throws with the node kind when no state is registered', () => {
			const node = makeFakeNode('list');
			expect(() => expectStateForNode(node)).toThrowError(/list/);
		});
	});

	describe('dev-mode double-register warning', () => {
		let warnSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		});
		afterEach(() => {
			warnSpy.mockRestore();
		});

		it('warns when the same node is registered twice in DEV', () => {
			if (!import.meta.env.DEV) return;
			const node = makeFakeNode();
			registerBlockListState(node, makeFakeState());
			registerBlockListState(node, makeFakeState());
			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy.mock.calls[0][0]).toContain('double register');
		});

		it('does not warn on a fresh registration', () => {
			const node = makeFakeNode();
			registerBlockListState(node, makeFakeState());
			expect(warnSpy).not.toHaveBeenCalled();
		});
	});

	describe('createBlockListState ↔ registry integration', () => {
		it('registers the state for the node on creation', () => {
			const node: CstNode = {
				kind: 'list',
				leadingTrivia: '',
				raw: '',
				metadata: { ordered: false },
				innerPrefix: '',
				children: [
					{
						kind: 'listItem',
						leadingTrivia: '',
						raw: '',
						metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
					}
				],
				innerSuffix: ''
			};
			const state = createBlockListState(() => node);
			expect(getStateForNode(node)).toBe(state);
		});

		it('re-registration by createBlockListState overwrites the previous entry', () => {
			const node: CstNode = {
				kind: 'list',
				leadingTrivia: '',
				raw: '',
				metadata: { ordered: false },
				innerPrefix: '',
				children: [],
				innerSuffix: ''
			};
			const first = createBlockListState(() => node);
			const second = createBlockListState(() => node);
			expect(getStateForNode(node)).toBe(second);
			expect(getStateForNode(node)).not.toBe(first);
		});
	});
});
