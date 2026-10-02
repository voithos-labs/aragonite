// The ops the container kit drives for the built-in list and table: a table column insert and a
// list indent, each through the kind's own context. No published API can perform either op, so
// they live beside the built-in profiles, which hand them to the kit as `drivers`.

import type { CstNode } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { parse } from '$lib/core/parser';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createListContext } from '$lib/editor-actions/list-context';
import { createTableMutationsContext } from '$lib/editor-actions/table-context';
import type { EditEvent } from '$lib/editor-events';
import {
	assert,
	assertIndices,
	assertIs,
	firstChildOfKind,
	subjectNode
} from '$lib/testing/conformance-core';
import {
	createHeadlessActions,
	recordingFocus,
	stubBlockEdit
} from '$lib/testing/headless-actions';
import { mountBlockListState } from '$lib/testing/headless-block-list.svelte';
import { assertParseConverged } from '$lib/testing/parse-convergence';

/** A table column op addresses cells by (rowIdx, colIdx) and emits the table's own path; the
 *  leading paragraph keeps the table off index 0, so a global index would differ. */
export async function checkTableLocalIndexAddressing(): Promise<void> {
	const parsed = parse('lead para\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n');
	subjectNode(parsed, 'table', [1], 'the leading-paragraph sample');
	const { ctx, doc, events } = mountTableMutations(parsed.children, 1);

	const seen: EditEvent[] = [];
	events.on('edit', (e) => seen.push(e));

	// Pinning the new cell's position by content proves cells are addressed by local column index
	// rather than appended at the end.
	await ctx.insertColumnRight(0);

	const liveTable = subjectNode(doc, 'table', [1], 'the document after the insert');
	for (const row of liveTable.children!) {
		const cells = row.children!.map((c) => c.raw);
		assertIs(cells.length, 3, 'every row gained one cell');
		assert(cells[0] !== '', 'column 0 unchanged');
		assertIs(cells[1], '', 'new empty cell landed at the addressed colIdx 1');
		assert(cells[2] !== '', 'original second cell shifted to colIdx 2');
	}
	const editEvent = seen.find((e) => e.op === 'tableInsertColumn');
	assert(editEvent, 'tableInsertColumn edit event fired');
	assertIndices(editEvent.path, [1], 'column op emits the table’s own local path');
	assertParseConverged(doc, 'doc converges after a grid column op');
}

/** Indenting item 1 under item 0 spans the outer list and the new nested list. */
export async function checkListIndentOneUndo(): Promise<void> {
	const list = firstChildOfKind('- alpha\n- beta\n', 'list');
	const { deps } = createHeadlessActions([list]);
	const controller = createUndoController(deps);

	const listState = mountBlockListState(() => list);
	// indentItem reaches into item 0 through expectStateForNode, so register each item.
	for (const item of list.children!) mountBlockListState(() => item);

	const ctx = createListContext({
		scope: {
			get index() {
				return 0;
			},
			get node() {
				return list;
			},
			get path() {
				return [0];
			}
		},
		getLineEnding: () => documentLineEnding(deps.doc),
		state: listState,
		parentBlockEdit: stubBlockEdit(),
		parentFocus: recordingFocus(),
		parentListContext: undefined,
		controller,
		reading: deps.reading
	});

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.indentItem(1);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'list indentItem (multi-scope) pushes exactly one undo entry');
	assertIs(deps.doc.children[0].children!.length, 1, 'item 1 was indented out of the outer list');
	assertParseConverged(deps.doc, 'doc converges after a multi-scope strip op');
}

/** A column insert writes the table and every row, as one undo entry. */
export async function checkTableColumnOneUndo(): Promise<void> {
	const table = firstChildOfKind('| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n', 'table');
	const { ctx, deps } = mountTableMutations([table], 0);

	const before = deps.undoManager.getStacks().undo.length;
	await ctx.insertColumnRight(0);
	const after = deps.undoManager.getStacks().undo.length;

	assertIs(after - before, 1, 'table insertColumn (multi-scope) pushes exactly one undo entry');
	assertParseConverged(deps.doc, 'doc converges after a multi-scope grid op');
}

function mountTableMutations(children: CstNode[], tableIndex: number) {
	const table = children[tableIndex];
	const { deps, doc, events } = createHeadlessActions(children);
	const controller = createUndoController(deps);
	const rootContainerEdit = createContainerEditActions(deps, controller);

	const rowsState = mountBlockListState(() => table);
	// commitColumnEdit resolves each row through expectStateForNode, so register them.
	for (const row of table.children!) mountBlockListState(() => row);

	const ctx = createTableMutationsContext({
		get node() {
			return table;
		},
		get myPath() {
			return [tableIndex];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return { rowIdx: 0, colIdx: 0 };
		},
		parentContainerEdit: rootContainerEdit,
		controller,
		reading: deps.reading
	});
	return { ctx, deps, doc, events };
}
