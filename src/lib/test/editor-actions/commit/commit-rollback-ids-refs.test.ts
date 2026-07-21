import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import type { MultiScopeTarget } from '$lib/editor-actions/deps';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

function makeContainer(childRaws: string[]): CstNode {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', leadingTrivia: '', raw: r })),
		childIds: childRaws.map((_, i) => `c-${i}`)
	} as CstNode;
}

// publishScopeView writes each scope's mutated ids/refs into reactive state
// BEFORE the ancestor-raw rebuild. A throw after the doc scope published left
// top-level blockIds/refs reflecting the rolled-back mutation until the next
// commit. The rollback must snapshot and restore them per scope.
describe('commitMultiScope — ids/refs rollback on a post-publish throw', () => {
	it('restores top-level blockIds/refs when a later scope throws after the doc scope published', async () => {
		const { deps, getBlockIds, getBlockRefs } = makeEditorActionsDeps([
			makeContainer(['- a\n']),
			makeContainer(['- b\n'])
		]);
		const controller = createUndoController(deps);

		const idsBefore = [...getBlockIds()];
		const refsBefore = [...getBlockRefs()];

		// Scope 2's innerBlockRefs setter throws on the FIRST write (publish) and
		// succeeds after (rollback) — a deterministic fault after scope 1 (the doc
		// scope) has already published its grown ids/refs.
		let refsWrites = 0;
		let stashedRefs: (unknown | undefined)[] = [];
		const throwingState: BlockListState = {
			get innerBlockIds() {
				return deps.doc.children[1].childIds ?? [];
			},
			set innerBlockIds(_v: string[]) {},
			get innerBlockRefs() {
				return stashedRefs as never;
			},
			set innerBlockRefs(v) {
				if (refsWrites++ === 0) throw new Error('publish boom');
				stashedRefs = v as unknown[];
			}
		};

		const scopes: MultiScopeTarget[] = [
			controller.getDocScope(),
			{ node: deps.doc.children[1], state: throwingState, path: [1] }
		];

		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: ([docScope]) => {
					// Append a top-level block so the doc-scope publish rewrites blockIds
					// (a fresh id) — the mutation the rollback must undo.
					docScope.children.push({ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' } as CstNode);
					return [{ op: 'insert', at: docScope.children.length - 1, count: 1 }, { op: 'noop' }];
				}
			})
		).rejects.toThrow('publish boom');

		expect(getBlockIds()).toEqual(idsBefore);
		expect(getBlockRefs()).toEqual(refsBefore);
	});
});
