// A table's header is its first row on every route that moves, adds, removes or splits rows: the
// live tree reads as a reload of its bytes would, and undo restores the table it started from.
// Miss-analysis: each route set the header flag itself, and the undo property's generator drew only
// the routes that never put a new row first (insert below, the guarded move), so no row saw it.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createTableMutationsContext } from '#lib/editor-actions/table-context.js';
import { sliceTableAtRow } from '#lib/tree-operations/paste/table-slice.js';
import { checkReadsBack } from '#lib/invariants/reads-back.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { makeBlockListState } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { makeHarness, type Harness } from '#lib/test/undo/restoration-ops.js';

// The last row holds a cell past the header's count, which a header can't keep.
const SOURCE = '| a | b |\n| - | - |\n| c | d |\n| e | f | g |\n';

const headerFlags = (table: CstNode) =>
	table.children!.map((row) => (row.metadata as { isHeader: boolean }).isHeader);

function tableActions(h: Harness) {
	const rowsState = makeBlockListState(() => h.deps.doc.children[0]);
	return createTableMutationsContext({
		get node() {
			return h.deps.doc.children[0];
		},
		get myPath() {
			return [0];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return null;
		},
		parentContainerEdit: h.rootContainerEdit,
		controller: h.controller,
		reading: fixtureReading()
	});
}

describe('every table action keeps the header on the first row', () => {
	it.each([
		{ route: 'insert above the header', run: (t: Actions) => t.insertRowAbove(0) },
		{ route: 'insert below the header', run: (t: Actions) => t.insertRowBelow(0) },
		{ route: 'a body row moved first', run: (t: Actions) => t.reorderRowTo(1, 0) },
		{ route: 'a wide body row moved first', run: (t: Actions) => t.reorderRowTo(2, 0) },
		{ route: 'the header moved last', run: (t: Actions) => t.reorderRowTo(0, 2) },
		{ route: 'the header deleted', run: (t: Actions) => t.deleteRow(0) }
	])('$route', async ({ run }) => {
		const h = makeHarness(SOURCE);

		await run(tableActions(h));

		const table = h.deps.doc.children[0];
		expect(headerFlags(table)).toEqual(table.children!.map((_, i) => i === 0));
		expect(describeConvergence(h.deps.doc)).toBeNull();

		await h.history.requestUndo();
		expect(serialize(h.deps.doc)).toBe(SOURCE);
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});
});

type Actions = ReturnType<typeof tableActions>;

describe('a table built from another table’s rows takes its first row as the header', () => {
	it.each([
		{ rowGoes: 'first' as const, at: 1 },
		{ rowGoes: 'second' as const, at: 2 }
	])('a paste split, the slice row going $rowGoes', ({ rowGoes, at }) => {
		const { firstHalf, secondHalf } = sliceTableAtRow(parse(SOURCE).children[0], at, rowGoes);

		for (const half of [firstHalf!, secondHalf!]) {
			expect(headerFlags(half)).toEqual(half.children!.map((_, i) => i === 0));
			expect(checkReadsBack(half, defaultGrammarView)).toBeNull();
		}
	});
});
