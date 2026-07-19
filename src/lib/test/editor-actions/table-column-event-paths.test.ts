import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTableMutationsContext } from '$lib/editor-actions/table-context';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { maybeCommitTableCoverageDelete } from '$lib/selection/range-delete-table-coverage';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/ops';
import type { SelectionPoint } from '$lib/selection/primitives';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '../harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// Column-shaped table ops address the TABLE, with the column index in the event
// detail — a column is not a child node, so a [tableIdx, colIdx] path would
// resolve to a ROW (or nothing). Two sites share this contract by design: the
// alignment ops (editor-actions/table-context) and the coverage-driven column
// delete (selection/range-delete-table-coverage). Reverting either back to the
// old [index, colIdx] / [tableIdx, colIdx] shape turns these red.

const TABLE = '| a | b |\n| --- | --- |\n| c | d |\n';

// ── Alignment ops (table-context) ────────────────────────────────────────────

function makeTableMutations() {
	const { deps, events } = makeEditorActionsDeps([parse(TABLE).children[0]]);
	const liveTable = () => deps.doc.children[0];
	const rowsState = makeBlockListState(liveTable, ['row-0', 'row-1']);
	const controller = createUndoController(deps);
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	const mutations = createTableMutationsContext({
		get node() {
			return liveTable();
		},
		get myPath() {
			return [0];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 1, colIdx: 1 };
		},
		parentContainerEdit: createContainerEditActions(deps, controller),
		controller,
		focusCell: vi.fn(),
		announceReorder: vi.fn()
	});
	return { mutations, edits };
}

describe('alignment ops emit the table path with colIdx in the detail', () => {
	it('cycleAlignment targets the table, not the column index', async () => {
		const { mutations, edits } = makeTableMutations();

		await mutations.cycleAlignment(1);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({
			op: 'tableCycleAlignment',
			path: [0],
			detail: { colIdx: 1 }
		});
	});

	it('setColumnAlignment targets the table, not the column index', async () => {
		const { mutations, edits } = makeTableMutations();

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

function makeColumnCoverageEnv() {
	const { deps, events } = makeEditorActionsDeps([parse(TABLE).children[0]]);
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
	const ctx: CrossBlockMutationContext = {
		selection: deps.selectionState,
		getDoc: () => deps.doc,
		getBlockElByPath: () => null,
		revealPath: deps.revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0)
	};
	return { deps, table, ctx, edits };
}

describe('coverage-driven column delete emits the table path with colIdx in the detail', () => {
	it('a full-column selection targets the table, not the column index', async () => {
		const { deps, table, ctx, edits } = makeColumnCoverageEnv();
		// Cell-index endpoints spanning column 0 across both rows (2 cols × 2 rows).
		const start: SelectionPoint = { path: [0, 0, 0], offset: 0 };
		const end: SelectionPoint = { path: [0, 1, 0], offset: 2 };
		deps.selectionState.enterCrossBlock(start, end);

		const result = await maybeCommitTableCoverageDelete(
			ctx,
			table,
			start,
			end,
			undefined,
			undefined
		);

		expect(result).not.toBeNull();
		const del = edits.find((e) => e.op === 'tableDeleteColumn');
		expect(del).toBeDefined();
		expect(del!.path).toEqual([0]);
		expect(del!.detail).toMatchObject({ colIdx: 0, crossBlock: true });
	});
});
