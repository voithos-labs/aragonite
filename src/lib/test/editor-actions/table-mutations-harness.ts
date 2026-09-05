// One live-getter table-mutations context over a parsed table; each suite passes its
// single distinguishing axis. `mountedRows` registers only those rows' states, as
// windowing leaves a mounted slice.

import { vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createTableMutationsContext } from '$lib/editor-actions/table-context';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

export function makeTableMutations(
	source: string,
	opts: {
		focusedCell?: { rowIdx: number; colIdx: number } | null;
		mountedRows?: number[];
		rowIds?: string[];
	} = {}
) {
	const { deps, events } = makeEditorActionsDeps([parse(source).children[0]]);
	const liveTable = () => deps.doc.children[0];
	const rowsState = makeBlockListState(liveTable, opts.rowIds);
	if (opts.mountedRows) {
		registerBlockListState(liveTable(), rowsState);
		for (const rowIdx of opts.mountedRows) {
			registerBlockListState(
				liveTable().children![rowIdx],
				makeBlockListState(() => liveTable().children![rowIdx])
			);
		}
	}
	const controller = createUndoController(deps);
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	const focusCell = vi.fn();
	const announceReorder = vi.fn();
	const focusedCell = opts.focusedCell === undefined ? { rowIdx: 1, colIdx: 1 } : opts.focusedCell;
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
			return focusedCell;
		},
		parentContainerEdit: createContainerEditActions(deps, controller),
		controller,
		focusCell,
		announceReorder
	});
	return { deps, mutations, edits, focusCell, announceReorder };
}
