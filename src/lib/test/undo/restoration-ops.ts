/**
 * Op vocabulary + driver for the undo-restoration property test. Every op routes
 * through the REAL action factories, never the commit primitive directly, so the
 * walk exercises the entry paths a user reaches. Headless boundary: cell-addressed
 * focus and IME paths need a DOM and stay with the e2e suites.
 */

import fc from 'fast-check';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { displayLength, trimTrailingLineEnding } from '../../core/lines';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createContainerEditActions } from '../../editor-actions/container-edit';
import { createHistoryActions } from '../../editor-actions/commit/history';
import {
	createStandardNestedActions,
	type NestedActionsBundle
} from '../../editor-actions/nested/nested-actions';
import { createListContext } from '../../editor-actions/list-context';
import { createTableMutationsContext } from '../../editor-actions/table-context';
import { performCrossBlockDelete } from '../../selection/cross-block/ops';
import type { SelectionPoint } from '../../selection/primitives';
import { registerBlockListState } from '../../reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '../harness/editor-actions';

// ── Arbitraries ──────────────────────────────────────────────────────────────

export type Op =
	| { t: 'typeTop'; i: number; n: number }
	| { t: 'typeChar'; i: number; off: number; ch: number }
	| { t: 'splitTop'; i: number; off: number }
	| { t: 'mergeTopNext'; i: number }
	| { t: 'insertItem'; i: number }
	| { t: 'splitItem'; i: number; off: number }
	| { t: 'indent'; i: number }
	| { t: 'typeItem'; i: number; n: number }
	| { t: 'toggleTask'; i: number }
	| { t: 'typeQuote'; i: number; n: number }
	| { t: 'tableInsertRow'; i: number }
	| { t: 'tableDeleteRow'; i: number }
	| { t: 'tableInsertColumn'; i: number }
	| { t: 'tableDeleteColumn'; i: number }
	| { t: 'tableReorderRow'; i: number; dir: -1 | 1 }
	| { t: 'tableCycleAlignment'; i: number }
	| { t: 'typeCell'; r: number; c: number; n: number }
	| { t: 'rangeDelete'; a: number; b: number; off: number }
	| { t: 'undo' }
	| { t: 'redo' };

/** Typing one of these mid-content re-classifies the block, which is the
 *  live-tree-vs-raw divergence class neutral filler characters cannot reach. */
export const MARKDOWN_TYPE_CHARS = ['|', '#', '>', '-', '*', '`', '[', ']', '!'] as const;

/** Resolves the arbitrary `off` by code point, not by `displayLength`'s UTF-16
 *  units, so an astral source is never sliced through a surrogate pair. */
export function typeCharCodePointOffset(body: string, off: number): number {
	return off % ([...body].length + 1);
}

export const arbOp: fc.Arbitrary<Op> = fc.oneof(
	fc.record({ t: fc.constant('typeTop' as const), i: fc.nat(5), n: fc.nat(2) }),
	fc.record({ t: fc.constant('typeChar' as const), i: fc.nat(5), off: fc.nat(24), ch: fc.nat(8) }),
	fc.record({ t: fc.constant('splitTop' as const), i: fc.nat(5), off: fc.nat(8) }),
	fc.record({ t: fc.constant('mergeTopNext' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('insertItem' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('splitItem' as const), i: fc.nat(5), off: fc.nat(6) }),
	fc.record({ t: fc.constant('indent' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('typeItem' as const), i: fc.nat(5), n: fc.nat(2) }),
	fc.record({ t: fc.constant('toggleTask' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('typeQuote' as const), i: fc.nat(3), n: fc.nat(2) }),
	fc.record({ t: fc.constant('tableInsertRow' as const), i: fc.nat(4) }),
	fc.record({ t: fc.constant('tableDeleteRow' as const), i: fc.nat(4) }),
	fc.record({ t: fc.constant('tableInsertColumn' as const), i: fc.nat(3) }),
	fc.record({ t: fc.constant('tableDeleteColumn' as const), i: fc.nat(3) }),
	fc.record({
		t: fc.constant('tableReorderRow' as const),
		i: fc.nat(4),
		dir: fc.constantFrom(-1 as const, 1 as const)
	}),
	fc.record({ t: fc.constant('tableCycleAlignment' as const), i: fc.nat(3) }),
	fc.record({ t: fc.constant('typeCell' as const), r: fc.nat(4), c: fc.nat(3), n: fc.nat(2) }),
	fc.record({ t: fc.constant('rangeDelete' as const), a: fc.nat(5), b: fc.nat(5), off: fc.nat(4) }),
	fc.record({ t: fc.constant('undo' as const) }),
	fc.record({ t: fc.constant('redo' as const) })
);

// CRLF and astral/combining sources join the ASCII/LF ones because the divergence
// class lives partly in line-ending and code-point handling.
export const arbSource = fc.constantFrom(
	'alpha\n\n- one\n- two\n- three\n\nomega\n',
	'1. first\n2. second\n3. third\n',
	'- a\n  - b\n- c\n\npara\n',
	'lead\n\n> quoted\n\n- x\n- y\n',
	'intro\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n\n- one\n- two\n',
	'lead\r\n\r\n- one\r\n- two\r\n- three\r\n\r\ntail\r\n',
	'álpha\n\n- \u{1D52C}\u{1D52D}\u{1D52E}\n- two\n- three\n\nomegä\n'
);

// ── Harness ──────────────────────────────────────────────────────────────────

export function makeHarness(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return {
		deps,
		controller,
		blockEdit: createBlockEditActions(deps, controller),
		rootContainerEdit: createContainerEditActions(deps, controller),
		history: createHistoryActions(deps, controller)
	};
}

export type Harness = ReturnType<typeof makeHarness>;

/** Register fresh states for every container in the subtree — the headless
 *  stand-in for component (re)mounting after identity-changing commits. */
export function registerSubtreeStates(node: CstNode): void {
	if (!node.children) return;
	registerBlockListState(
		node,
		makeBlockListState(() => node)
	);
	for (const child of node.children) registerSubtreeStates(child);
}

function nestedBundleAt(h: Harness, index: number): NestedActionsBundle {
	const state = makeBlockListState(() => h.deps.doc.children[index]);
	return createStandardNestedActions(
		state,
		makeNestedActionsDeps({
			index,
			getNode: () => h.deps.doc.children[index],
			path: [index],
			parent: { blockEdit: h.blockEdit, focus: makeStubFocus(), containerEdit: h.rootContainerEdit }
		})
	);
}

// ── Op runners ───────────────────────────────────────────────────────────────

export async function runOp(h: Harness, op: Op): Promise<void> {
	for (const child of h.deps.doc.children) registerSubtreeStates(child);
	switch (op.t) {
		case 'undo':
			return h.history.requestUndo();
		case 'redo':
			return h.history.requestRedo();
		case 'typeChar':
			return runTypeChar(h, op);
		case 'typeTop':
		case 'splitTop':
		case 'mergeTopNext':
			return runTopOp(h, op);
		case 'insertItem':
		case 'splitItem':
		case 'indent':
		case 'toggleTask':
		case 'typeItem':
			return runListOp(h, op);
		case 'typeQuote':
			return runQuoteOp(h, op);
		case 'tableInsertRow':
		case 'tableDeleteRow':
		case 'tableInsertColumn':
		case 'tableDeleteColumn':
		case 'tableReorderRow':
		case 'tableCycleAlignment':
		case 'typeCell':
			return runTableOp(h, op);
		case 'rangeDelete':
			return runRangeDelete(h, op);
	}
}

async function runTopOp(
	h: Harness,
	op: Extract<Op, { t: 'typeTop' | 'splitTop' | 'mergeTopNext' }>
): Promise<void> {
	const doc = h.deps.doc;
	const paragraphs = doc.children
		.map((c, i) => ({ c, i }))
		.filter(({ c }) => c.kind === 'paragraph');
	if (paragraphs.length === 0) return;
	const { c, i } = paragraphs[op.i % paragraphs.length];
	if (op.t === 'typeTop') {
		const text = trimTrailingLineEnding(c.raw) + 'x'.repeat(op.n + 1) + '\n';
		await h.blockEdit.updateBlockContent(i, text, 0);
	} else if (op.t === 'splitTop') {
		await h.blockEdit.splitBlock(i, Math.min(op.off, displayLength(c.raw)));
	} else {
		await h.blockEdit.mergeWithNext(i);
	}
}

/** Splices through the same `updateBlockContent` entry TextEditableBlock types on,
 *  which reparses — so a `>` at offset 0 re-classifies the block as a live keystroke
 *  would, and the oracle holds only if that re-classification is byte-faithful. */
async function runTypeChar(h: Harness, op: Extract<Op, { t: 'typeChar' }>): Promise<void> {
	const doc = h.deps.doc;
	const paragraphs = doc.children
		.map((c, i) => ({ c, i }))
		.filter(({ c }) => c.kind === 'paragraph');
	if (paragraphs.length === 0) return;
	const { c, i } = paragraphs[op.i % paragraphs.length];
	const body = trimTrailingLineEnding(c.raw);
	const at = typeCharCodePointOffset(body, op.off);
	const cps = [...body];
	const ch = MARKDOWN_TYPE_CHARS[op.ch % MARKDOWN_TYPE_CHARS.length];
	const next = [...cps.slice(0, at), ch, ...cps.slice(at)].join('');
	const utf16At = cps.slice(0, at).join('').length;
	await h.blockEdit.updateBlockContent(i, next + '\n', utf16At, utf16At + 1);
}

async function runListOp(
	h: Harness,
	op: Extract<Op, { t: 'insertItem' | 'splitItem' | 'indent' | 'typeItem' | 'toggleTask' }>
): Promise<void> {
	const doc = h.deps.doc;
	const listIndex = doc.children.findIndex((c) => c.kind === 'list');
	if (listIndex === -1) return;
	const list = doc.children[listIndex];
	if (!list.children || list.children.length === 0) return;
	const itemIdx = op.i % list.children.length;
	const item = list.children[itemIdx];

	const listState = makeBlockListState(() => h.deps.doc.children[listIndex]);
	const listDeps = makeNestedActionsDeps({
		index: listIndex,
		getNode: () => h.deps.doc.children[listIndex],
		path: [listIndex],
		parent: { blockEdit: h.blockEdit, focus: makeStubFocus(), containerEdit: h.rootContainerEdit }
	});
	const bundle = createStandardNestedActions(listState, listDeps);
	const context = createListContext({
		scope: {
			get index() {
				return listIndex;
			},
			get node() {
				return h.deps.doc.children[listIndex];
			},
			get path() {
				return [listIndex];
			}
		},
		state: listState,
		parentBlockEdit: makeStubBlockEdit(),
		parentFocus: makeStubFocus(),
		parentListContext: undefined,
		controller: h.controller
	});

	if (op.t === 'insertItem') {
		await context.insertItemAfter(itemIdx);
	} else if (op.t === 'splitItem') {
		const leaf = item.children?.[0];
		if (leaf?.kind !== 'paragraph') return;
		await context.splitItemAtOffset(itemIdx, 0, Math.min(op.off, displayLength(leaf.raw)));
	} else if (op.t === 'indent') {
		if (itemIdx === 0) return;
		await context.indentItem(itemIdx);
	} else if (op.t === 'toggleTask') {
		const checked = item.metadata && 'taskChecked' in item.metadata && item.metadata.taskChecked;
		await bundle.blockEdit.updateBlockMetadata(itemIdx, {
			taskItem: true,
			taskChecked: !checked,
			taskMarker: checked ? '[ ] ' : '[x] '
		});
	} else {
		const leaf = item.children?.[0];
		if (leaf?.kind !== 'paragraph') return;
		const itemState = makeBlockListState(() => h.deps.doc.children[listIndex].children![itemIdx]);
		const itemBundle = createStandardNestedActions(
			itemState,
			makeNestedActionsDeps({
				index: itemIdx,
				getNode: () => h.deps.doc.children[listIndex].children![itemIdx],
				path: [listIndex, itemIdx],
				parent: bundle
			})
		);
		const text = trimTrailingLineEnding(leaf.raw) + 'y'.repeat(op.n + 1) + '\n';
		await itemBundle.blockEdit.updateBlockContent(0, text, 0);
	}
}

async function runQuoteOp(h: Harness, op: { i: number; n: number }): Promise<void> {
	const doc = h.deps.doc;
	const quoteIndex = doc.children.findIndex((c) => c.kind === 'blockquote');
	if (quoteIndex === -1) return;
	const quote = doc.children[quoteIndex];
	if (!quote.children || quote.children.length === 0) return;
	const innerIdx = op.i % quote.children.length;
	const leaf = quote.children[innerIdx];
	if (leaf.kind !== 'paragraph') return;
	const bundle = nestedBundleAt(h, quoteIndex);
	const text = trimTrailingLineEnding(leaf.raw) + 'q'.repeat(op.n + 1) + '\n';
	await bundle.blockEdit.updateBlockContent(innerIdx, text, 0);
}

async function runTableOp(
	h: Harness,
	op: Extract<
		Op,
		{
			t:
				| 'tableInsertRow'
				| 'tableDeleteRow'
				| 'tableInsertColumn'
				| 'tableDeleteColumn'
				| 'tableReorderRow'
				| 'tableCycleAlignment'
				| 'typeCell';
		}
	>
): Promise<void> {
	const doc = h.deps.doc;
	const tableIndex = doc.children.findIndex((c) => c.kind === 'table');
	if (tableIndex === -1) return;
	const table = doc.children[tableIndex];
	const rowCount = table.children?.length ?? 0;
	const colCount = metadataOf(table, 'table').columnCount;
	if (rowCount === 0 || colCount === 0) return;

	if (op.t === 'typeCell') {
		const rowIdx = op.r % rowCount;
		const row = table.children![rowIdx];
		if (!row.children || row.children.length === 0) return;
		const colIdx = op.c % row.children.length;
		const rowState = makeBlockListState(() => h.deps.doc.children[tableIndex].children![rowIdx]);
		const rowBundle = createStandardNestedActions(
			rowState,
			makeNestedActionsDeps({
				index: rowIdx,
				getNode: () => h.deps.doc.children[tableIndex].children![rowIdx],
				path: [tableIndex, rowIdx],
				parent: nestedBundleAt(h, tableIndex)
			})
		);
		const text = trimTrailingLineEnding(row.children[colIdx].raw) + 'z'.repeat(op.n + 1);
		await rowBundle.blockEdit.updateBlockContent(colIdx, text, 0);
		return;
	}

	const rowsState = makeBlockListState(() => h.deps.doc.children[tableIndex]);
	const ctx = createTableMutationsContext({
		get node() {
			return h.deps.doc.children[tableIndex];
		},
		get myPath() {
			return [tableIndex];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return null;
		},
		parentContainerEdit: h.rootContainerEdit,
		controller: h.controller,
		focusCell: () => {},
		announceReorder: () => {}
	});

	if (op.t === 'tableInsertRow') await ctx.insertRowBelow(op.i % rowCount);
	else if (op.t === 'tableDeleteRow') await ctx.deleteRow(op.i % rowCount);
	else if (op.t === 'tableInsertColumn') await ctx.insertColumnRight(op.i % colCount);
	else if (op.t === 'tableDeleteColumn') await ctx.deleteColumn(op.i % colCount);
	else if (op.t === 'tableReorderRow') {
		const rowIdx = op.i % rowCount;
		await (op.dir === -1 ? ctx.moveRowUp(rowIdx) : ctx.moveRowDown(rowIdx));
	} else await ctx.cycleAlignment(op.i % colCount);
}

async function runRangeDelete(
	h: Harness,
	op: { a: number; b: number; off: number }
): Promise<void> {
	const doc = h.deps.doc;
	const len = doc.children.length;
	if (len < 2) return;
	const first = op.a % len;
	const second = (first + 1 + (op.b % (len - 1))) % len;
	const [startIdx, endIdx] = first < second ? [first, second] : [second, first];

	const start = leafPoint(doc.children[startIdx], startIdx, 0);
	const end = leafPoint(doc.children[endIdx], endIdx, op.off);
	if (!start || !end) return;

	h.deps.selectionState.enterCrossBlock(start, end);
	await performCrossBlockDelete({
		selection: h.deps.selectionState,
		getDoc: () => h.deps.doc,
		getBlockElByPath: () => null,
		revealPath: h.deps.revealPath,
		controller: h.controller,
		pushUndoSnapshot: () => h.controller.pushUndoSnapshot(startIdx, 0),
		grammar: undefined
	});
}

/** Synthetic selection endpoint inside `block` (top-level index `i`). Tables return
 *  null: their endpoints carry cell coordinates, a DOM-driven encoding this driver
 *  does not synthesize. */
function leafPoint(block: CstNode, i: number, off: number): SelectionPoint | null {
	if (block.kind === 'paragraph' || block.kind === 'heading') {
		return { path: [i], offset: Math.min(off, displayLength(block.raw)) };
	}
	if (block.kind === 'blockquote') {
		const leaf = block.children?.[0];
		if (leaf?.kind !== 'paragraph') return null;
		return { path: [i, 0], offset: Math.min(off, displayLength(leaf.raw)) };
	}
	if (block.kind === 'list') {
		const leaf = block.children?.[0]?.children?.[0];
		if (leaf?.kind !== 'paragraph') return null;
		return { path: [i, 0, 0], offset: Math.min(off, displayLength(leaf.raw)) };
	}
	return null;
}
