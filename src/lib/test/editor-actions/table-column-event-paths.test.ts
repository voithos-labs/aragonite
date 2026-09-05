import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { maybeCommitTableCoverageDelete } from '$lib/selection/range-delete-table-coverage';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/ops';
import type { SelectionPoint } from '$lib/selection/primitives';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { makeTableMutations } from './table-mutations-harness';
import type { EditEvent } from '$lib/editor-events';

// A column is not a child node, so column-shaped ops address the TABLE and carry the
// column index in the event detail. Two sites share the contract: the alignment ops
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
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
		grammar: undefined,
		getPresentationMode: undefined,
		linkRef: undefined
	};
	return { deps, table, ctx, edits };
}

describe('coverage-driven column delete emits the table path with colIdx in the detail', () => {
	it('a full-column selection targets the table, not the column index', async () => {
		const { deps, table, ctx, edits } = makeColumnCoverageEnv();
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
