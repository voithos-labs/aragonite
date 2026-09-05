// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import {
	performCrossBlockDeleteSync,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import type { EditEvent } from '$lib/editor-events';

function makeEnv(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
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
	return {
		...harness,
		controller,
		mutCtx,
		history: createHistoryActions(harness.deps, controller)
	};
}

function selectAcross(env: ReturnType<typeof makeEnv>, anchor: number[], focus: number[]) {
	env.deps.selectionState.enterCrossBlock({ path: anchor, offset: 1 }, { path: focus, offset: 2 });
}

describe('performCrossBlockDeleteSync — commit-primitive convergence', () => {
	it('keeps blockIds in lockstep with doc.children synchronously after the call', () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		selectAcross(env, [0], [2]);

		performCrossBlockDeleteSync(env.mutCtx);

		expect(env.doc.children).toHaveLength(1);
		expect(env.getBlockIds()).toHaveLength(env.doc.children.length);
		expect(env.deps.selectionState.isCrossBlock).toBe(false);
	});

	it('emits one op:delete edit event synchronously', () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));
		selectAcross(env, [0], [2]);

		performCrossBlockDeleteSync(env.mutCtx);

		expect(editEvents.map((e) => e.op)).toEqual(['delete']);
	});

	it('pushes a single undo entry whose restore is byte-exact', async () => {
		const env = makeEnv('# A\n\npara B\n\npara C\n');
		const original = serialize(env.deps.doc);
		selectAcross(env, [0], [2]);

		performCrossBlockDeleteSync(env.mutCtx);
		expect(env.deps.undoManager.getStacks().undo).toHaveLength(1);

		await tick();
		await env.history.requestUndo();
		expect(serialize(env.deps.doc)).toBe(original);
	});

	it('cross-container: surviving blockquote keeps childIds in lockstep with children', () => {
		const env = makeEnv('> aaaa\n>\n> bbbb\n\npara C\n');
		registerBlockListState(
			env.doc.children[0],
			makeBlockListState(() => env.deps.doc.children[0])
		);
		selectAcross(env, [0, 0], [1]);

		performCrossBlockDeleteSync(env.mutCtx);

		const quote = env.deps.doc.children[0];
		expect(quote.children).toHaveLength(1);
		expect(quote.childIds).toHaveLength(quote.children!.length);
		expect(env.getBlockIds()).toHaveLength(env.doc.children.length);
	});
});

// GH #129 at the cross-block door: a delete that blanks the tail block exposes the
// document's folded trailing line, so both commit paths must let the settle materialize
// it AND report the grown tail to the ids sync.
describe('cross-block delete beside the folded trailing blank (GH #129)', () => {
	it('pure top-level: the whole-content delete materializes the fold in step', async () => {
		const env = makeEnv('alpha\n\nbeta\n\n');
		env.doc.suffix = parse('alpha\n\nbeta\n\n').suffix;
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1], offset: 4 });

		performCrossBlockDeleteSync(env.mutCtx);
		await tick();

		expect(env.doc.children).toHaveLength(2);
		expect(env.doc.suffix).toBe('');
		expect(env.getBlockIds()).toHaveLength(2);
		expectParseConverged(env.deps.doc);
	});

	it('cross-container: the net-zero splice still remints the tail slot id', async () => {
		const env = makeEnv('alpha\n\n> q\n\n');
		env.doc.suffix = parse('alpha\n\n> q\n\n').suffix;
		registerBlockListState(
			env.doc.children[1],
			makeBlockListState(() => env.deps.doc.children[1])
		);
		const idsBefore = [...env.getBlockIds()];
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 0 }, { path: [1, 0], offset: 1 });

		performCrossBlockDeleteSync(env.mutCtx);
		await tick();

		expect(env.doc.children).toHaveLength(2);
		expect(env.doc.suffix).toBe('');
		expect(env.getBlockIds()).toHaveLength(2);
		// The quote died; its slot now holds the materialized blank, which must not keep its id.
		expect(env.getBlockIds()[1]).not.toBe(idsBefore[1]);
		expectParseConverged(env.deps.doc);
	});
});
