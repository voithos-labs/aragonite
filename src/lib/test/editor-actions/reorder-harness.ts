// Mounted-container reorder harness for the reorder-action suites: seeded innerBlockRefs
// mimic a mounted container ({#each} never runs in node env) and the registered state lets
// the action's expectStateForNode resolve.

import { expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { replaceRefs } from '$lib/reactivity/publish-ref.svelte';
import { mockRef, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';

export function makeReorderContainer(source: string, opts: { nodeIndex?: number } = {}) {
	const at = opts.nodeIndex ?? 0;
	const harness = makeEditorActionsDeps(parse(source).children);
	const node = () => harness.doc.children[at];
	const controller = createUndoController(harness.deps);
	const history = createHistoryActions(harness.deps, controller);
	const reorder = createReorderAction(harness.deps, controller);
	const state = createBlockListState(node);
	replaceRefs(
		state.innerBlockRefs,
		(node().children ?? []).map(() => mockRef())
	);
	return {
		doc: harness.doc,
		deps: harness.deps,
		node,
		state,
		reorder,
		undo: history.requestUndo,
		undoDepth: () => harness.deps.undoManager.getStacks().undo.length,
		ids: () => state.innerBlockIds,
		// Convergence, not just a byte round-trip: the round trip is blind to a stale
		// container raw or a renumber-desynced marker the permutation left behind.
		assertStable() {
			expectParseConverged(harness.doc);
			const live = serialize(harness.doc);
			expect(serialize(parse(live))).toBe(live);
		}
	};
}
