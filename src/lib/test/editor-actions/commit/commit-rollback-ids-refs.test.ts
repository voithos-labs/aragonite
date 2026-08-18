import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import type { MultiScopeTarget } from '$lib/action-contracts';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { refSlotsOver } from '$lib/reactivity/publish-ref.svelte';
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

// publishScopeView writes each scope's ids/refs into reactive state BEFORE the
// ancestor-raw rebuild, so a later throw leaves them reflecting a rolled-back mutation.
describe('commitMultiScope — ids/refs rollback on a post-publish throw', () => {
	it('restores top-level blockIds/refs when a later scope throws after the doc scope published', async () => {
		const { deps, getBlockIds, getBlockRefs } = makeEditorActionsDeps([
			makeContainer(['- a\n']),
			makeContainer(['- b\n'])
		]);
		const controller = createUndoController(deps);

		const idsBefore = [...getBlockIds()];
		const refsBefore = [...getBlockRefs()];

		// Armed once `mutate` has run, so the fault lands on the publish pass rather than the
		// prepare reads before it, and disarms so the rollback's own read still resolves.
		let armed = false;
		const stashedRefs: BlockListState['innerBlockRefs'] = [];
		const throwingState: BlockListState = {
			get innerBlockIds() {
				return deps.doc.children[1].childIds ?? [];
			},
			set innerBlockIds(_v: string[]) {},
			get innerBlockRefs() {
				if (armed) {
					armed = false;
					throw new Error('publish boom');
				}
				return stashedRefs;
			},
			refSlots: refSlotsOver(stashedRefs)
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
					// A fresh id makes the doc-scope publish rewrite blockIds — the mutation to undo.
					docScope.children.push({ kind: 'paragraph', leadingTrivia: '', raw: 'x\n' } as CstNode);
					armed = true;
					return [{ op: 'insert', at: docScope.children.length - 1, count: 1 }, { op: 'noop' }];
				}
			})
		).rejects.toThrow('publish boom');

		expect(getBlockIds()).toEqual(idsBefore);
		expect(getBlockRefs()).toEqual(refsBefore);
	});
});
