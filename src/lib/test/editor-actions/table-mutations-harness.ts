// One live-getter table-mutations context over a parsed table; each suite passes its
// single distinguishing axis. `mountedRows` registers only those rows' states, as
// windowing leaves a mounted slice.

import { vi } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createTableMutationsContext } from '#lib/editor-actions/table-context.js';
import { createContainerEditActions } from '#lib/editor-actions/container-edit.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	mountEveryBlock
} from '#lib/test/harness/editor-actions.js';
import type { EditEvent } from '#lib/editor-events.js';

export function makeTableMutations(
	source: string,
	opts: {
		focusedCell?: { rowIdx: number; colIdx: number } | null;
		mountedRows?: number[];
		rowIds?: string[];
	} = {}
) {
	const { deps, events, landings } = makeEditorActionsDeps([parse(source).children[0]]);
	// Every cell answers the caret landing, so a test reads which cell each edit's caret went to.
	mountEveryBlock(deps);
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
	const announceEdit = vi.fn();
	const controller = createUndoController(deps, announceEdit);
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
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
		reading: deps.reading
	});
	return { deps, mutations, edits, landings, announceEdit };
}
