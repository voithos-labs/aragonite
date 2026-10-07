// The reorder action over a headless editor, for the reorder suites. No component mounts a
// container here, so `makeReorderContainer` builds its list state and fills its refs by hand, and
// the action finds the state a mounted container would register.

import { expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode, Document } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { replaceRefs } from '$lib/reactivity/publish-ref.svelte';
import { stubBlockComponent, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';

/** The reorder action and its undo over `source`; `announce` hears what the edit live region is
 *  told. */
export function makeReorderHarness(
	source: string | CstNode[] | Document,
	options: Parameters<typeof makeEditorActionsDeps>[1] & {
		announce?: (message: string) => void;
	} = {}
) {
	const { announce, ...depsOptions } = options;
	const harness = makeEditorActionsDeps(source, depsOptions);
	const controller = createUndoController(harness.deps, announce);
	return {
		...harness,
		reorder: createReorderAction(harness.deps, controller),
		undo: createHistoryActions(harness.deps, controller).requestUndo
	};
}

/** `path` names a nested container (a quote inside a list item); `nodeIndex` a top-level one. */
export function makeReorderContainer(
	source: string,
	opts: { nodeIndex?: number; path?: number[] } = {}
) {
	const path = opts.path ?? [opts.nodeIndex ?? 0];
	const harness = makeReorderHarness(parse(source).children);
	const node = () => blockNodeAt(harness.doc, path)!;
	const state = createBlockListState(node);
	replaceRefs(
		state.innerBlockRefs,
		(node().children ?? []).map(() => stubBlockComponent())
	);
	return {
		doc: harness.doc,
		deps: harness.deps,
		node,
		state,
		reorder: harness.reorder,
		undo: harness.undo,
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
