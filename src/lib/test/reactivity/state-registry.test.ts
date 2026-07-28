import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
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

	describe('dev-mode contested-claim warning', () => {
		let warnSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		});
		afterEach(() => {
			warnSpy.mockRestore();
		});

		/** A torn-down mount's `bind:this` slots are cleared; a live one's are not. */
		function stateWithRefs(mounted: boolean): BlockListState {
			return {
				innerBlockIds: ['a'],
				innerBlockRefs: [mounted ? ({} as BlockListState['innerBlockRefs'][number]) : undefined]
			};
		}

		it('warns when a second LIVE component claims a node the first still renders', async () => {
			if (!import.meta.env.DEV) return;
			const node = makeFakeNode();
			registerBlockListState(node, stateWithRefs(true));
			registerBlockListState(node, stateWithRefs(true));

			await tick();
			expect(warnSpy).toHaveBeenCalledOnce();
			expect(warnSpy.mock.calls[0][0]).toContain('two live components');
		});

		// The remount handoff: the loser is torn down within the same flush, so by the
		// time the claim is re-asked it holds no refs to orphan. Warning here would fire
		// on every list indent (docs/issues.md, characterized 2026-07-28).
		it('stays silent when the loser was torn down in the same flush', async () => {
			const node = makeFakeNode();
			const loser = stateWithRefs(true);
			registerBlockListState(node, loser);
			registerBlockListState(node, stateWithRefs(true));
			loser.innerBlockRefs[0] = undefined;

			await tick();
			expect(warnSpy).not.toHaveBeenCalled();
		});

		// A third registration means the contested pair is already history — reporting it
		// would name a winner that no longer owns the node.
		it('stays silent when a later registration superseded the contested winner', async () => {
			const node = makeFakeNode();
			registerBlockListState(node, stateWithRefs(true));
			registerBlockListState(node, stateWithRefs(true));
			registerBlockListState(node, stateWithRefs(true));

			await tick();
			// The second contest (2nd vs 3rd) is still live and reports; the first is not.
			expect(warnSpy).toHaveBeenCalledOnce();
		});

		it('does not warn on a fresh registration', async () => {
			const node = makeFakeNode();
			registerBlockListState(node, makeFakeState());

			await tick();
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
