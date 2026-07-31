// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import {
	performCrossBlockDelete,
	type CrossBlockMutationContext
} from '$lib/selection/cross-block/ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';
import { metadataOf, type CstNode } from '$lib/core/nodes';
import type { EditEvent } from '$lib/editor-events';

// The stale-table-row-ids class: a cross-block delete whose whole-row snap splices table.children
// must commit the table as its own scope, keeping row BlockListState ids/refs in lockstep.

const HEADER_PLUS_TWO = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';

function makeEnv(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	// Production wiring: getDoc enables the state seam's table-endpoint
	// normalization + whole-row snap, which the plain harness omits.
	harness.deps.selectionState = createSelectionState({ getDoc: () => harness.deps.doc });
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

function registerTableState(env: ReturnType<typeof makeEnv>, index: number): BlockListState {
	const state = makeBlockListState(() => env.deps.doc.children[index]);
	registerBlockListState(env.deps.doc.children[index], state);
	return state;
}

function expectLockstep(state: BlockListState, node: CstNode): void {
	expect(state.innerBlockIds).toHaveLength(node.children!.length);
	expect(state.innerBlockRefs).toHaveLength(node.children!.length);
}

describe('performCrossBlockDelete — endpoint table as a commit scope', () => {
	it('paragraph → body cell: row state stays in lockstep, promoted header keeps its id', async () => {
		const env = makeEnv(`lead\n\n${HEADER_PLUS_TWO}`);
		const state = registerTableState(env, 1);
		const idsBefore = [...state.innerBlockIds];
		// Deep cell focus (row 1, col 0) — normalized to a cell-coordinate table
		// endpoint; the whole-row snap covers rows 0–1, promoting row 2 to header.
		env.deps.selectionState.enterCrossBlock(
			{ path: [0], offset: 2 },
			{ path: [1, 1, 0], offset: 1 }
		);

		await performCrossBlockDelete(env.mutCtx);

		const table = env.deps.doc.children[1];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(1);
		expectLockstep(state, table);
		expect(state.innerBlockIds).toEqual([idsBefore[2]]);
		expect(env.getBlockIds()).toHaveLength(env.deps.doc.children.length);
	});

	it('body cell → paragraph below: surviving header row keeps state in lockstep', async () => {
		const env = makeEnv(`${HEADER_PLUS_TWO}\ntail paragraph\n`);
		const state = registerTableState(env, 0);
		const idsBefore = [...state.innerBlockIds];
		env.deps.selectionState.enterCrossBlock(
			{ path: [0, 1, 0], offset: 0 },
			{ path: [1], offset: 5 }
		);

		await performCrossBlockDelete(env.mutCtx);

		const table = env.deps.doc.children[0];
		expect(table.kind).toBe('table');
		expect(table.children).toHaveLength(1);
		expectLockstep(state, table);
		expect(state.innerBlockIds).toEqual([idsBefore[0]]);
		expect(env.deps.doc.children[1].raw.trimEnd()).toBe('paragraph');
		expect(env.getBlockIds()).toHaveLength(env.deps.doc.children.length);
	});

	it('a table-endpoint delete commits atomically: one edit event, one undo entry', async () => {
		const env = makeEnv(`lead\n\n${HEADER_PLUS_TWO}`);
		registerTableState(env, 1);
		const editEvents: EditEvent[] = [];
		env.events.on('edit', (e) => editEvents.push(e));
		env.deps.selectionState.enterCrossBlock(
			{ path: [0], offset: 2 },
			{ path: [1, 1, 0], offset: 1 }
		);

		await performCrossBlockDelete(env.mutCtx);

		expect(editEvents.map((e) => e.op)).toEqual(['delete']);
		expect(env.deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(env.deps.selectionState.isCrossBlock).toBe(false);
	});

	it('same-path intra-table delete stays a cell clear: rows, ids, refs untouched', async () => {
		const env = makeEnv(HEADER_PLUS_TWO);
		const state = registerTableState(env, 0);
		const idsBefore = [...state.innerBlockIds];
		env.deps.selectionState.enterCrossBlock(
			{ path: [0, 1, 0], offset: 0 },
			{ path: [0, 2, 1], offset: 1 }
		);

		await performCrossBlockDelete(env.mutCtx);

		const table = env.deps.doc.children[0];
		expect(table.children).toHaveLength(3);
		expect(state.innerBlockIds).toEqual(idsBefore);
		expectLockstep(state, table);
		for (const row of table.children!.slice(1)) {
			for (const cell of row.children!) expect(cell.raw).toBe('');
		}
	});

	it('undo restores table children and row ids coherently', async () => {
		const env = makeEnv(`lead\n\n${HEADER_PLUS_TWO}`);
		const state = registerTableState(env, 1);
		const idsBefore = [...state.innerBlockIds];
		const original = serialize(env.deps.doc);
		env.deps.selectionState.enterCrossBlock(
			{ path: [0], offset: 2 },
			{ path: [1, 1, 0], offset: 1 }
		);

		await performCrossBlockDelete(env.mutCtx);
		await tick();
		await env.history.requestUndo();

		expect(serialize(env.deps.doc)).toBe(original);
		const table = env.deps.doc.children[1];
		expect(table.children).toHaveLength(3);
		expect(state.innerBlockIds).toEqual(idsBefore);
	});

	it('a delete consuming the whole end table removes the block, doc ids in lockstep', async () => {
		const env = makeEnv('lead\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		registerTableState(env, 1);
		env.deps.selectionState.enterCrossBlock(
			{ path: [0], offset: 2 },
			{ path: [1, 1, 0], offset: 1 }
		);

		await performCrossBlockDelete(env.mutCtx);

		expect(env.deps.doc.children).toHaveLength(1);
		expect(env.deps.doc.children[0].kind).toBe('paragraph');
		expect(env.getBlockIds()).toHaveLength(1);
	});
});

// A row registers its BlockListState on mount, so a windowed-out row never does. A full-column
// delete splices every row's cells, but only the mounted rows need a reactive scope.
describe('commitColumnDelete — a windowed-out row has no registered state', () => {
	// Three columns so canDeleteColumn permits removing one (≥2 must remain).
	const THREE_COL = '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';

	function registerRowState(env: ReturnType<typeof makeEnv>, rowIdx: number): BlockListState {
		const rowAt = () => env.deps.doc.children[0].children![rowIdx];
		const state = makeBlockListState(rowAt);
		registerBlockListState(rowAt(), state);
		return state;
	}

	function selectFirstColumn(env: ReturnType<typeof makeEnv>): void {
		// Column 0 across all rows: cellIdx 0 (row 0, col 0) → 6 (row 2, col 0) in a
		// 3×3 grid. Anchor carries the cell-coordinate flag like a real rect anchor.
		env.deps.selectionState.enterCrossBlock(
			{ path: [0], offset: 0, cellCoordinate: true },
			{ path: [0], offset: 6 }
		);
	}

	it('deletes the column without throwing when the middle row never mounted', async () => {
		const env = makeEnv(THREE_COL);
		registerTableState(env, 0);
		const header = registerRowState(env, 0);
		const lastRow = registerRowState(env, 2);
		// Row 1 stays windowed out — no registerRowState, so no registered state.
		selectFirstColumn(env);

		await performCrossBlockDelete(env.mutCtx, { tableCoverageDelete: true });

		const table = env.deps.doc.children[0];
		expect(metadataOf(table, 'table').columnCount).toBe(2);
		for (const row of table.children!) expect(row.children).toHaveLength(2);
		const out = serialize(env.deps.doc);
		expect(serialize(parse(out))).toBe(out);
		expect(header.innerBlockIds).toHaveLength(2);
		expect(lastRow.innerBlockIds).toHaveLength(2);
	});
});
