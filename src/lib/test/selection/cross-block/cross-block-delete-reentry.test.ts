// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { replaceRange } from '$lib/selection/cross-block/range-replace';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';
import { fixtureReading } from '../../harness/fixture-grammar';
import { rangeContext } from './range-context';

const SOURCE = '# A\n\npara B\n\npara C\n';

function makeEnv() {
	const harness = makeEditorActionsDeps(parse(SOURCE).children);
	const controller = createUndoController(harness.deps);
	return { ...harness, mutCtx: rangeContext(harness.deps, controller, fixtureReading()) };
}

const BACKSPACE = { kind: 'none', gesture: 'Backspace' } as const;

describe('a range removal re-entered before the first settles', () => {
	it('a second call arriving while the first awaits its commit does not double-delete', async () => {
		// Reference: the same selection deleted exactly once.
		const single = makeEnv();
		single.deps.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [2], offset: 2 });
		await replaceRange(single.mutCtx, BACKSPACE);
		const expected = serialize(single.deps.doc);

		// Overlap: the second call arrives before the first settles (key auto-repeat Backspace, or a
		// paste during the commit's tick).
		const env = makeEnv();
		// Every op, unfiltered: nothing on this path emits the debounced `input` (no typing precedes
		// the delete), so a spurious second event of any op fails the assertion.
		const editOps: string[] = [];
		env.events.on('edit', (e: EditEvent) => editOps.push(e.op));
		env.deps.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [2], offset: 2 });

		const first = replaceRange(env.mutCtx, BACKSPACE);
		const second = replaceRange(env.mutCtx, BACKSPACE);
		await Promise.all([first, second]);
		await tick();

		expect(editOps).toEqual(['delete']);
		expect(serialize(env.deps.doc)).toBe(expected);
	});
});
