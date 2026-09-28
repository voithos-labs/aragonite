/**
 * The `rangeDelete` branch for a table endpoint: a table's selection offsets are cell indices, so
 * the text merge does not apply. Surviving blocks are found afterwards by scanning for the node
 * ({@link survivorPath}), since deletions and cleanup shift sibling indices at any depth; one
 * linear scan per Backspace or Delete is cheap enough.
 */

import type { GrammarView } from '../schema/block-openers';
import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { CoveredRange } from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength, documentLineEnding } from '../core/lines';
import { cellRectBounds, cellRowCol } from '../cursor/coordinate-spaces';
import { cellIndexOf } from './primitives';
import {
	resolveEndWall,
	planCrossBlockDeletion,
	applyPlannedDeletion,
	rebuildSharedAncestries,
	truncateEndInPlace,
	truncateStartInPlace
} from './range-delete-ceremony';
import { comparePaths } from './path-math';
import { blockNodeAt, emptyParagraph } from '../tree-operations/node-primitives';
import {
	ensureUnsharedNode,
	ensureUnsharedPath,
	ensureUnsharedSubtree,
	rebuildOwnedContainer
} from '../tree-operations/unshare';
import { rebuildUnsharedAncestry } from '../tree-operations/chain-rebuild';
import { rebuildTableRowRaw } from '../schema/container-rebuilders';
import { promoteFirstRowToHeader } from '../tree-operations/table-mutations';
import { caretChildCount } from '../schema/reserved-chrome';
import { nearestChromeContainer, isChromeChild, caretWhereRemoved } from './range-delete-chrome';
import { countsCells } from '../schema/block-kind-descriptor';

// ── Public API ──────────────────────────────────────────────────────────────

export function involvesTable(startBlock: CstNode, endBlock: CstNode): boolean {
	return countsCells(startBlock) || countsCells(endBlock);
}

export function tableAwareRangeDelete(
	doc: Document,
	range: CoveredRange,
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const { grammar } = reading;
	const { start, end } = range;
	const sameBlock = comparePaths(start.path, end.path) === 0;

	// Copy both endpoint chains (and the table subtrees: cell raws, row splices, and header
	// promotion all write at depth) before any capture or mutation.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const startBlock = startChain[startChain.length - 1] ?? ownedEndpoint(doc, start.path, sharing);
	const endBlock = sameBlock
		? startBlock
		: (ensureUnsharedPath(doc, end.path, sharing).pop() ?? ownedEndpoint(doc, end.path, sharing));
	const startCells = countsCells(startBlock);
	const endCells = countsCells(endBlock);
	if (startCells) ensureUnsharedSubtree(startBlock, sharing);
	if (!sameBlock && endCells) ensureUnsharedSubtree(endBlock, sharing);

	if (sameBlock) {
		return deleteWithinTable(doc, start, end, startBlock, sharing, grammar);
	}
	if (startCells && endCells) {
		return deleteAcrossTwoTables(doc, range, startBlock, endBlock, sharing, grammar);
	}
	if (startCells) {
		return deleteFromTableIntoProse(doc, range, startBlock, endBlock, sharing, grammar, reading);
	}
	return deleteFromProseIntoTable(doc, range, startBlock, endBlock, sharing, grammar, reading);
}

/** The copied node for an endpoint whose chain came back short, never a bare reference into the
 *  live tree; a miss here is a caller bug. */
function ownedEndpoint(doc: Document, path: number[], sharing: SharingState): CstNode {
	const node = blockNodeAt(doc, path);
	if (!node) throw new Error('rangeDelete(table): endpoint path does not resolve to a block node');
	return ensureUnsharedNode(node, sharing);
}

// ── Same-block: whole-table or partial-table intra-table ───────────────────

// Caret returns as a deep [...tablePath, row, col] path so the follow-up paste / focus restore
// lands inside the anchor cell's contenteditable instead of the table wrapper.
function deleteWithinTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode,
	sharing: SharingState,
	grammar: GrammarView
): RangeDeleteResult {
	const startCell = cellIndexOf(start, 'deleteWithinTable:start');
	clearRectangularCells(table, startCell, cellIndexOf(end, 'deleteWithinTable:end'));
	rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);

	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const { row: anchorRow, col: anchorCol } = cellRowCol(startCell, cellsPerRow);

	return {
		newDoc: doc,
		collapsedCaret: { path: [...start.path, anchorRow, anchorCol], offset: 0 },
		tableRowSplices: []
	};
}

function clearRectangularCells(table: CstNode, anchorCellIdx: number, focusCellIdx: number): void {
	const colCount = metadataOf(table, 'table').columnCount;
	const { top, left, rows, cols } = cellRectBounds(anchorCellIdx, focusCellIdx, colCount);
	for (let r = top; r < top + rows; r++) {
		const row = table.children![r];
		for (let c = left; c < left + cols; c++) {
			row.children![c].raw = '';
		}
		rebuildTableRowRaw(row);
	}
}

// ── Case 1: prose start, table end ─────────────────────────────────────────

function deleteFromProseIntoTable(
	doc: Document,
	range: CoveredRange,
	startBlock: CstNode,
	table: CstNode,
	sharing: SharingState,
	grammar: GrammarView,
	reading: Reading
): RangeDeleteResult {
	const { start, end } = range;
	const startC = nearestChromeContainer(doc, start.path);
	const startIsChrome = startC !== null && isChromeChild(startC, start.path);
	const startTaken = range.unitHolding(start.path);

	// The snapped end cell is the whole-row inclusive last cell; deleteCellsAndCollapse takes an
	// exclusive end, so +1 clears the same rows the clipboard copied.
	const { result, splice } = deleteCellsAndCollapse(
		table,
		0,
		cellIndexOf(end, 'deleteFromProseIntoTable:end') + 1
	);

	const wall = resolveEndWall(doc, range, result === 'tableEmpty');
	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		range,
		result === 'tableEmpty' ? [end.path] : [],
		wall,
		sharing
	);

	applyPlannedDeletion(doc, plan, lcaPath, grammar);
	// A start whose container went whole has nothing left to truncate.
	const seam = startTaken
		? 0
		: truncateStartInPlace(
				doc,
				start,
				startBlock,
				startIsChrome,
				reading,
				sharing,
				'deleteFromProseIntoTable:start'
			);

	const tableSurvives = result === 'tableSurvives';
	if (tableSurvives) rebuildOwnedContainer(table, sharing);
	if (!startTaken) rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	rebuildSharedAncestries(doc, plan, sharing, grammar);
	if (tableSurvives) rebuildUnsharedAncestry(doc, survivorPath(doc, table), sharing, null, grammar);

	return {
		newDoc: doc,
		collapsedCaret: startTaken
			? caretWhereRemoved(doc, startTaken, sharing)
			: { path: start.path.slice(), offset: seam },
		tableRowSplices: splice ? [{ table, ...splice }] : []
	};
}

// ── Case 2: table start, prose end ─────────────────────────────────────────

function deleteFromTableIntoProse(
	doc: Document,
	range: CoveredRange,
	table: CstNode,
	endBlock: CstNode,
	sharing: SharingState,
	grammar: GrammarView,
	reading: Reading
): RangeDeleteResult {
	const { start, end } = range;
	const lineEnding = documentLineEnding(doc);
	const startCell = cellIndexOf(start, 'deleteFromTableIntoProse:start');
	const { result: tableResult, splice } = deleteCellsAndCollapse(
		table,
		startCell,
		totalCellCount(table)
	);

	const wall = resolveEndWall(doc, range, null);
	const consumed = wall?.consumed ?? false;
	const endIsChrome = wall !== null && !consumed && isChromeChild(wall.container, end.path);

	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		range,
		tableResult === 'tableEmpty' ? [start.path] : [],
		wall,
		sharing
	);

	// Truncate end first: its path is later in doc order, so deleting strictly-between doesn't
	// shift it. Skipped when the container dies whole.
	const tailNode = consumed
		? null
		: truncateEndInPlace(
				doc,
				end,
				endBlock,
				endIsChrome,
				reading,
				sharing,
				'deleteFromTableIntoProse:end'
			);
	applyPlannedDeletion(doc, plan, lcaPath, grammar);

	const tailPath = tailNode ? survivorPath(doc, tailNode) : null;

	if (tableResult === 'tableSurvives') {
		rebuildOwnedContainer(table, sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	}
	if (tailPath) rebuildUnsharedAncestry(doc, tailPath, sharing, null, grammar);
	rebuildSharedAncestries(doc, plan, sharing, grammar);

	// A fully consumed table lands the caret at the start of the surviving tail; otherwise in the
	// table's surviving anchor cell, or the nearest survivor when the tail went too.
	const collapsedCaret: SelectionPoint =
		tableResult === 'tableEmpty'
			? tailPath
				? { path: tailPath, offset: 0 }
				: caretNearestSurvivor(doc, start.path, sharing, lineEnding)
			: survivingAnchorCellCaret(table, start.path, startCell);

	return {
		newDoc: doc,
		collapsedCaret,
		tableRowSplices: splice ? [{ table, ...splice }] : []
	};
}

// The caret in the surviving table's anchor cell, which is cleared from the anchor on, so at its
// end; an anchor in column 0 means its row was removed, so the previous row's last cell.
function survivingAnchorCellCaret(
	table: CstNode,
	startPath: number[],
	anchorCellIdx: number
): SelectionPoint {
	const cellsPerRow = metadataOf(table, 'table').columnCount;
	const { row: anchorRow, col: anchorCol } = cellRowCol(anchorCellIdx, cellsPerRow);

	if (anchorCol > 0) {
		const cell = table.children![anchorRow].children![anchorCol];
		return { path: [...startPath, anchorRow, anchorCol], offset: displayLength(cell.raw) };
	}
	const survivorRow = anchorRow - 1;
	const survivorCol = cellsPerRow - 1;
	if (survivorRow < 0) {
		// Row 0 removed with the anchor in it: callers report 'tableEmpty' first, so this only
		// keeps the lookup off `children[-1]`.
		return { path: [...startPath, 0, 0], offset: 0 };
	}
	const survivor = table.children![survivorRow].children![survivorCol];
	return { path: [...startPath, survivorRow, survivorCol], offset: displayLength(survivor.raw) };
}

// ── Case 1+2 hybrid: both endpoints are tables ─────────────────────────────

function deleteAcrossTwoTables(
	doc: Document,
	range: CoveredRange,
	startTable: CstNode,
	endTable: CstNode,
	sharing: SharingState,
	grammar: GrammarView
): RangeDeleteResult {
	const { start, end } = range;
	const lineEnding = documentLineEnding(doc);
	const startCell = cellIndexOf(start, 'deleteAcrossTwoTables:start');
	const { result: startResult, splice: startSplice } = deleteCellsAndCollapse(
		startTable,
		startCell,
		totalCellCount(startTable)
	);
	// The snapped end cell is the whole-row inclusive last cell; +1 for the exclusive end.
	const { result: endResult, splice: endSplice } = deleteCellsAndCollapse(
		endTable,
		0,
		cellIndexOf(end, 'deleteAcrossTwoTables:end') + 1
	);

	const wall = resolveEndWall(doc, range, endResult === 'tableEmpty');
	const emptiedEndpoints: number[][] = [];
	if (startResult === 'tableEmpty') emptiedEndpoints.push(start.path);
	if (endResult === 'tableEmpty') emptiedEndpoints.push(end.path);
	const { plan, lcaPath } = planCrossBlockDeletion(doc, range, emptiedEndpoints, wall, sharing);

	applyPlannedDeletion(doc, plan, lcaPath, grammar);

	const endTablePath = endResult === 'tableSurvives' ? survivorPath(doc, endTable) : null;

	if (startResult === 'tableSurvives') {
		rebuildOwnedContainer(startTable, sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	}
	if (endTablePath) {
		rebuildOwnedContainer(endTable, sharing);
		rebuildUnsharedAncestry(doc, endTablePath, sharing, null, grammar);
	}
	rebuildSharedAncestries(doc, plan, sharing, grammar);

	let collapsedCaret: SelectionPoint;
	if (startResult === 'tableSurvives') {
		// The start table keeps its position (deletions are all at or after `start.path`).
		collapsedCaret = survivingAnchorCellCaret(startTable, start.path, startCell);
	} else if (endTablePath) {
		// Start emptied, so its block went and the end table shifted; land in its first cell.
		collapsedCaret = { path: [...endTablePath, 0, 0], offset: 0 };
	} else {
		collapsedCaret = caretNearestSurvivor(doc, start.path, sharing, lineEnding);
	}

	const tableRowSplices = [
		...(startSplice ? [{ table: startTable, ...startSplice }] : []),
		...(endSplice ? [{ table: endTable, ...endSplice }] : [])
	];
	return { newDoc: doc, collapsedCaret, tableRowSplices };
}

// Every block the caret could land in was removed, so a survivor is sought in the deleted block's
// own container, walking outward when the cleanup took that too.
function caretNearestSurvivor(
	doc: Document,
	startPath: number[],
	sharing: SharingState,
	lineEnding: string
): SelectionPoint {
	let containerPath = startPath.slice(0, -1);
	let childIdx = startPath[startPath.length - 1];
	let siblings = survivingChildren(doc, containerPath);
	while (siblings === null && containerPath.length > 0) {
		childIdx = containerPath[containerPath.length - 1];
		containerPath = containerPath.slice(0, -1);
		siblings = survivingChildren(doc, containerPath);
	}

	if (siblings) {
		const beforeIdx = childIdx - 1;
		if (beforeIdx >= 0) {
			const before = siblings[beforeIdx];
			const beforePath = [...containerPath, beforeIdx];
			return before.kind === 'table'
				? lastCellCaret(before, beforePath)
				: survivorEndCaret(before, beforePath);
		}
		return survivorStartCaret(siblings[0], [...containerPath, 0]);
	}

	const filler = emptyParagraph('', lineEnding);
	sharing.stamp(filler);
	doc.children.push(filler);
	return { path: [0], offset: 0 };
}

/** A container's children when it survived with any, else null. */
function survivingChildren(doc: Document, path: number[]): CstNode[] | null {
	const node = path.length === 0 ? doc : blockNodeAt(doc, path);
	const children = node?.children;
	return children && children.length > 0 ? children : null;
}

// The caret at a survivor's end, descending to the leaf: the last child at each step, or child
// 0 for a collapsed container, whose title line is all that shows.
function survivorEndCaret(node: CstNode, path: number[]): SelectionPoint {
	let leaf = node;
	const leafPath = path.slice();
	while (leaf.children && leaf.children.length > 0) {
		const next = caretChildCount(leaf) - 1;
		leaf = leaf.children[next];
		leafPath.push(next);
	}
	return { path: leafPath, offset: displayLength(leaf.raw) };
}

// The caret at a survivor's start, the counterpart of `survivorEndCaret`. The first child at
// each level is also the title line a collapsed container shows, so no collapse case is needed.
function survivorStartCaret(node: CstNode, path: number[]): SelectionPoint {
	let leaf = node;
	const leafPath = path.slice();
	while (leaf.children && leaf.children.length > 0) {
		leaf = leaf.children[0];
		leafPath.push(0);
	}
	return { path: leafPath, offset: 0 };
}

function lastCellCaret(table: CstNode, tablePath: number[]): SelectionPoint {
	const lastRow = table.children!.length - 1;
	const lastCol = metadataOf(table, 'table').columnCount - 1;
	const cell = table.children![lastRow].children![lastCol];
	return { path: [...tablePath, lastRow, lastCol], offset: displayLength(cell.raw) };
}

// ── Post-delete path resolution (identity scan; cost class in the file header) ─

function survivorPath(doc: Document, node: CstNode): number[] {
	const path = pathOfNode(doc, node);
	if (!path) {
		throw new Error('tableAwareRangeDelete: surviving block not found after deletions');
	}
	return path;
}

function pathOfNode(parent: Document | CstNode, target: CstNode): number[] | null {
	const children = parent.children ?? [];
	for (let i = 0; i < children.length; i++) {
		if (children[i] === target) return [i];
		const sub = pathOfNode(children[i], target);
		if (sub) return [i, ...sub];
	}
	return null;
}

// ── Cell-range cleanup ─────────────────────────────────────────────────────

type ClearResult = 'tableSurvives' | 'tableEmpty';

interface CellDeleteOutcome {
	result: ClearResult;
	/** Whole-row window spliced out of `table.children`; null when only cell raws cleared. */
	splice: { at: number; count: number } | null;
}

/** Clears the cells in `[startCellIdx, endCellIdx)` and removes rows fully inside the range,
 *  reporting the row window spliced so the commit can sync row state. */
function deleteCellsAndCollapse(
	table: CstNode,
	startCellIdx: number,
	endCellIdx: number
): CellDeleteOutcome {
	if (startCellIdx >= endCellIdx) return { result: 'tableSurvives', splice: null };
	clearCellsInRange(table, startCellIdx, endCellIdx);

	const meta = metadataOf(table, 'table');
	const rows = table.children!;
	const cellsPerRow = meta.columnCount;

	const { row: startRow, col: startCol } = cellRowCol(startCellIdx, cellsPerRow);
	const { row: lastRowInRange, col: lastColInRange } = cellRowCol(endCellIdx - 1, cellsPerRow);

	// First range row is fully covered iff startCol === 0; last iff
	// lastColInRange === cellsPerRow - 1; middle rows always are.
	const firstFull = startCol === 0 ? startRow : startRow + 1;
	const lastFull = lastColInRange === cellsPerRow - 1 ? lastRowInRange : lastRowInRange - 1;

	const headerRemoved = firstFull <= 0 && lastFull >= 0;
	const splice = firstFull <= lastFull ? { at: firstFull, count: lastFull - firstFull + 1 } : null;

	if (splice) {
		rows.splice(splice.at, splice.count);
	}

	if (rows.length === 0) return { result: 'tableEmpty', splice };
	if (headerRemoved) {
		promoteFirstRowToHeader(table);
	}
	return { result: 'tableSurvives', splice };
}

function clearCellsInRange(table: CstNode, startCellIdx: number, endCellIdx: number): void {
	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const rows = table.children!;
	const touchedRows = new Set<number>();
	for (let i = startCellIdx; i < endCellIdx; i++) {
		const { row: r, col: c } = cellRowCol(i, cellsPerRow);
		rows[r].children![c].raw = '';
		touchedRows.add(r);
	}
	for (const r of touchedRows) rebuildTableRowRaw(rows[r]);
}

function totalCellCount(table: CstNode): number {
	const meta = metadataOf(table, 'table');
	return (table.children?.length ?? 0) * meta.columnCount;
}
