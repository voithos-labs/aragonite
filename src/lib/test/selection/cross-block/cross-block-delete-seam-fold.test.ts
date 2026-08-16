// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	performCrossBlockDelete,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

// A range delete leaves its survivor beside an absorbing neighbour ABOVE the selection, so the
// settle folds a seam outside `[startTop, endTop]` — the window a length-diff descriptor names.
// Miss-analysis: every cross-block delete pin asserted the scope's own children and bytes, and the
// descriptor's own pins called `computeScopeDescriptor` with hand-written lengths, so no case ever
// compared the published id array against the children a settle-folded delete actually left.

/** A list above indented prose: their adjacent bytes re-read as one list, and the fold cascades. */
const ABSORBING_NEIGHBOUR = '- a\n\nAB\n\n  cd\n\n  ef\n';

function makeEnv(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	harness.deps.selectionState = createSelectionState({ getDoc: () => harness.deps.doc });
	const controller = createUndoController(harness.deps);
	const mutCtx: CrossBlockMutationContext = {
		selection: harness.deps.selectionState,
		getDoc: () => harness.deps.doc,
		getBlockElByPath: () => null,
		revealPath: harness.deps.revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
		grammar: undefined,
		getPresentationMode: undefined,
		linkRef: undefined
	};
	return { ...harness, controller, mutCtx };
}

describe('a cross-block delete whose settle folds a seam above the selection', () => {
	it('publishes one doc id per surviving block, and the absorber keeps its own', async () => {
		const env = makeEnv(ABSORBING_NEIGHBOUR);
		const listId = env.getBlockIds()[0];
		env.deps.selectionState.enterCrossBlock({ path: [1], offset: 0 }, { path: [2], offset: 0 });

		await performCrossBlockDelete(env.mutCtx);

		expect(serialize(env.deps.doc)).toBe('- a\n\n  cd\n\n  ef\n');
		expect(env.deps.doc.children.map((c) => c.kind)).toEqual(['list']);
		expect(env.getBlockIds()).toEqual([listId]);
	});

	it('keeps a container scope in lockstep when the fold eats its own children', async () => {
		const env = makeEnv('> - a\n>\n> AB\n>\n>   cd\n>\n>   ef\n');
		const quote = env.deps.doc.children[0];
		const state = makeBlockListState(() => env.deps.doc.children[0]);
		registerBlockListState(quote, state);
		const listId = state.innerBlockIds[0];
		env.deps.selectionState.enterCrossBlock(
			{ path: [0, 1], offset: 0 },
			{ path: [0, 2], offset: 0 }
		);

		await performCrossBlockDelete(env.mutCtx);

		expect(serialize(env.deps.doc)).toBe('> - a\n>\n>   cd\n>\n>   ef\n');
		expect(env.deps.doc.children[0].children!.map((c) => c.kind)).toEqual(['list']);
		expect(state.innerBlockIds).toEqual([listId]);
	});

	// The doc root keeps no id array of its own, so its ledger is BORROWED. One left behind would
	// be maintained forever by the next top-level splice, against ids nothing reconciles.
	it('gives the document root’s borrowed ledger back', async () => {
		const env = makeEnv('lead\n\n> quoted\n\ntail\n');
		const quote = env.deps.doc.children[1];
		registerBlockListState(
			quote,
			makeBlockListState(() => env.deps.doc.children[1])
		);
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 4 }, { path: [1, 0], offset: 6 });

		await performCrossBlockDelete(env.mutCtx);

		expect(env.getBlockIds()).toHaveLength(env.deps.doc.children.length);
		expect(env.deps.doc.childIds).toBeUndefined();
	});

	it('leaves the merged survivor’s id alone when nothing folds', async () => {
		const env = makeEnv('one\n\ntwo\n\nthree\n');
		const [firstId, , thirdId] = env.getBlockIds();
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 1 });

		await performCrossBlockDelete(env.mutCtx);

		expect(serialize(env.deps.doc)).toBe('owo\n\nthree\n');
		expect(env.getBlockIds()).toEqual([firstId, thirdId]);
	});
});
