// @vitest-environment jsdom
// Deleting a table's header row promotes the next row, through the table's own action and through
// a whole-row selection alike, and undo restores the header and every row unchanged.
// Miss-analysis: header deletes were checked by bytes only, and a header flag written through to a
// row the undo entry held keeps the bytes, so neither route had a test that could see it.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { replaceRange } from '$lib/selection/cross-block/range-replace';
import { rangeContext } from '../selection/cross-block/range-context';
import type { SelectionPoint } from '$lib/selection/primitives';
import { makeBlockListState } from '$lib/test/harness/editor-actions';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { makeHarness, runOp, type Harness } from '$lib/test/undo/restoration-ops';

const SOURCE = '| h | i |\n| --- | --- |\n| a | b |\n| c | d |\n';

/** Selects the header row whole (cells 0 and 1) and deletes it as Ctrl+Shift+Backspace does. */
async function deleteHeaderBySelection(h: Harness): Promise<void> {
	const table = h.deps.doc.children[0];
	registerBlockListState(
		table,
		makeBlockListState(() => h.deps.doc.children[0])
	);
	const start: SelectionPoint = { path: [0], offset: 0, cellCoordinate: true };
	const end: SelectionPoint = { path: [0], offset: 1, cellCoordinate: true };
	h.deps.selectionState.enterCrossBlock(start, end);
	await replaceRange(rangeContext(h.deps, h.controller, fixtureReading()), {
		kind: 'none',
		gesture: 'Backspace'
	});
}

describe('a deleted header row comes back on undo', () => {
	it.each([
		{
			route: 'the table’s row delete',
			run: (h: Harness) => runOp(h, { t: 'tableDeleteRow', i: 0 })
		},
		{ route: 'a whole-row selection', run: deleteHeaderBySelection }
	])('through $route', async ({ run }) => {
		const h = makeHarness(SOURCE);

		await run(h);
		expect(serialize(h.deps.doc)).toBe('| a | b |\n| --- | --- |\n| c | d |\n');

		await h.history.requestUndo();
		expect(serialize(h.deps.doc)).toBe(SOURCE);
		// A header flag written through to a row the entry held would restore two header rows.
		expectParseConverged(h.deps.doc);
	});
});
