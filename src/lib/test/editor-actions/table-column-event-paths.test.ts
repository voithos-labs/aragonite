import { describe, it, expect } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { commitGridLineDelete } from '#lib/selection/range-delete-table-coverage.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import { makeBlockListState, makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { makeTableMutations } from './table-mutations-harness';
import type { EditEvent } from '#lib/editor-events.js';
import type { GridLineCoverage } from '#lib/selection/range-delete-table-coverage.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';

// A column is not a child node, so column edits address the table and carry the column
// index in the event detail. Two sites share the contract: the alignment edits
// (editor-actions/table-context) and the coverage-driven column delete
// (selection/range-delete-table-coverage).

const TABLE = '| a | b |\n| --- | --- |\n| c | d |\n';

// ── Alignment ops (table-context) ────────────────────────────────────────────

const alignmentEnv = () => makeTableMutations(TABLE, { rowIds: ['row-0', 'row-1'] });

describe('alignment ops emit the table path with colIdx in the detail', () => {
	it('cycleAlignment targets the table, not the column index', async () => {
		const { mutations, edits } = alignmentEnv();

		await mutations.cycleAlignment(1);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({
			op: 'tableCycleAlignment',
			path: [0],
			detail: { colIdx: 1 }
		});
	});

	it('setColumnAlignment targets the table, not the column index', async () => {
		const { mutations, edits } = alignmentEnv();

		await mutations.setColumnAlignment(1, 'center');

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({
			op: 'tableSetAlignment',
			path: [0],
			detail: { colIdx: 1 }
		});
	});
});

// ── Coverage-driven column delete (range-delete-table-coverage) ───────────────

function makeColumnCoverageEnv(source = TABLE) {
	const { deps, events } = makeEditorActionsDeps([parse(source).children[0]]);
	const table = deps.doc.children[0];
	registerBlockListState(
		table,
		makeBlockListState(() => deps.doc.children[0])
	);
	(table.children ?? []).forEach((_, r) =>
		registerBlockListState(
			deps.doc.children[0].children![r],
			makeBlockListState(() => deps.doc.children[0].children![r])
		)
	);
	const controller = createUndoController(deps);
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	const ctx = { selection: deps.selectionState, getDoc: () => deps.doc, controller };
	return { deps, ctx, edits };
}

describe('coverage-driven column delete emits the table path with colIdx in the detail', () => {
	it('a full-column selection targets the table, not the column index', async () => {
		const { deps, ctx, edits } = makeColumnCoverageEnv();
		deps.selectionState.enterCrossBlock(
			{ path: [0, 0, 0], offset: 0 },
			{ path: [0, 1, 0], offset: 0 }
		);
		const { start, end } = deps.selectionState;
		const { grid } = rangeCoverage(deps.doc, coverRange(deps.doc, start!, end!));
		if (grid?.kind !== 'column') throw new Error(`expected a whole column, got ${grid?.kind}`);

		const caret = await commitGridLineDelete(ctx, grid);

		expect(caret).not.toBeNull();
		const del = edits.find((e) => e.op === 'tableDeleteColumn');
		expect(del).toBeDefined();
		expect(del!.path).toEqual([0]);
		expect(del!.detail).toMatchObject({ colIdx: 0, crossBlock: true });
	});

	// Miss-analysis: `rangeCoverage` reads a one-column table as the whole table, so no test reached
	// the refusal; only a hand-made coverage does, and a delete there would leave no column.
	it('a column coverage handed over for a one-column table is refused and flagged', async () => {
		const source = '| a |\n| --- |\n| c |\n';
		const { ctx, edits } = makeColumnCoverageEnv(source);
		const grid: GridLineCoverage = {
			kind: 'column',
			path: docPathFrom([0]),
			rect: { top: 0, left: 0, rows: 2, cols: 1 }
		};

		const caret = await commitGridLineDelete(ctx, grid);

		expect(caret).toBeNull();
		expect(edits).toEqual([]);
		expect(serialize(ctx.getDoc())).toBe(source);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:grid-column-delete']);
	});
});
