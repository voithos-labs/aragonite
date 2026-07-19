// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import {
	performCrossBlockDelete,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

const SOURCE = '# A\n\npara B\n\npara C\n';

function makeEnv(revealPath?: CrossBlockMutationContext['revealPath']) {
	const harness = makeEditorActionsDeps(parse(SOURCE).children);
	const controller = createUndoController(harness.deps);
	const mutCtx: CrossBlockMutationContext = {
		selection: harness.deps.selectionState,
		getDoc: () => harness.deps.doc,
		getBlockElByPath: () => null,
		revealPath: revealPath ?? harness.deps.revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0)
	};
	return { ...harness, controller, mutCtx };
}

describe('performCrossBlockDelete — re-entrancy across the reveal await', () => {
	it("a second call entering during the first's reveal await does not double-delete", async () => {
		// Reference: the same selection deleted exactly once.
		const single = makeEnv();
		single.deps.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [2], offset: 2 });
		await performCrossBlockDelete(single.mutCtx);
		const expected = serialize(single.deps.doc);

		// Overlap: the second call arrives while the first is parked on revealPath
		// (key auto-repeat Backspace / paste during the reveal await).
		let release!: () => void;
		const gate = new Promise<null>((r) => (release = () => r(null)));
		const env = makeEnv(() => gate);
		const editOps: string[] = [];
		env.events.on('edit', (e: EditEvent) => {
			if (e.op !== 'input') editOps.push(e.op);
		});
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [2], offset: 2 });

		const first = performCrossBlockDelete(env.mutCtx);
		const second = performCrossBlockDelete(env.mutCtx);
		release();
		await Promise.all([first, second]);
		await tick();

		expect(editOps).toEqual(['delete']);
		expect(serialize(env.deps.doc)).toBe(expected);
	});
});
