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
		grammar: undefined
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
