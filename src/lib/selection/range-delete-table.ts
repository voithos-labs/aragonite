/**
 * Table-aware branch of rangeDelete: tables encode selection offsets as cell
 * indices, so prose raw-merge doesn't apply.
 */

import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { displayLength } from '../core/lines';
import { walkBetween, comparePaths, assertCharOffset } from './primitives';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import { lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import { nodeAt } from '../tree-operations/node-ops';
import {
	ensureUnsharedPath,
	ensureUnsharedSubtree,
	rebuildOwnedContainer,
	rebuildUnsharedAncestry
} from '../tree-operations/unshare';
import { rebuildTableRowRaw } from '../schema/container-rebuilders';

// ── Public API ──────────────────────────────────────────────────────────────

export function involvesTable(startBlock: CstNode, endBlock: CstNode): boolean {
	return startBlock.kind === 'table' || endBlock.kind === 'table';
}

/**
 * Coverage classification for an intra-table cell-index range. Drives the
 * Backspace dispatch: full-table → delete table block; full-row → delete row;
 * full-column → delete column; otherwise → clear cells.
 */
export type TableCoverageKind = 'table' | 'row' | 'column' | 'cells';

export interface TableCoverage {
	kind: TableCoverageKind;
	rowIdx?: number;
	colIdx?: number;
}

export function classifyTableSelectionCoverage(
	startCellIdx: number,
	endCellIdx: number,
	columnCount: number,
	rowCount: number
): TableCoverage {
	const lo = Math.min(startCellIdx, endCellIdx);
	const hi = Math.max(startCellIdx, endCellIdx);
	const cellCount = columnCount * rowCount;

	if (lo === 0 && hi === cellCount - 1) return { kind: 'table' };

	const startRow = Math.floor(lo / columnCount);
	const startCol = lo - startRow * columnCount;
	const endRow = Math.floor(hi / columnCount);
	const endCol = hi - endRow * columnCount;

	if (startRow === endRow && startCol === 0 && endCol === columnCount - 1) {
		return { kind: 'row', rowIdx: startRow };
	}
	if (startCol === endCol && startRow === 0 && endRow === rowCount - 1) {
		return { kind: 'column', colIdx: startCol };
	}
	return { kind: 'cells' };
}

export function tableAwareRangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState
): RangeDeleteResult {
	const sameBlock = comparePaths(start.path, end.path) === 0;

	// Own both endpoint spines (and table subtrees — cell raws, row splices,
	// and header promotion all write at depth) before any capture or mutation.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const startBlock = startChain[startChain.length - 1] ?? (nodeAt(doc, start.path) as CstNode);
	const endBlock = sameBlock
		? startBlock
		: (ensureUnsharedPath(doc, end.path, sharing).pop() ?? (nodeAt(doc, end.path) as CstNode));
	if (startBlock.kind === 'table') ensureUnsharedSubtree(startBlock, sharing);
	if (!sameBlock && endBlock.kind === 'table') ensureUnsharedSubtree(endBlock, sharing);

	if (sameBlock) {
		return deleteWithinTable(doc, start, end, startBlock, sharing);
	}
	if (startBlock.kind === 'table' && endBlock.kind === 'table') {
		return deleteAcrossTwoTables(doc, start, end, startBlock, endBlock, sharing);
	}
	if (startBlock.kind === 'table') {
		return deleteFromTableIntoProse(doc, start, end, startBlock, endBlock, sharing);
	}
	return deleteFromProseIntoTable(doc, start, end, startBlock, endBlock, sharing);
}

// ── Same-block: whole-table or partial-table intra-table ───────────────────

// Caret returns as a deep [...tablePath, anchorRow, anchorCol] path so the
// follow-up paste / focus restore lands inside the anchor cell's contenteditable
// instead of the table wrapper.
function deleteWithinTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode,
	sharing: SharingState
): RangeDeleteResult {
	clearRectangularCells(table, start.offset, end.offset);
	rebuildUnsharedAncestry(doc, start.path, sharing);

	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const anchorRow = Math.floor(start.offset / cellsPerRow);
	const anchorCol = start.offset - anchorRow * cellsPerRow;

	return {
		newDoc: doc,
		collapsedCaret: { path: [...start.path, anchorRow, anchorCol], offset: 0 }
	};
}

function clearRectangularCells(table: CstNode, anchorCellIdx: number, focusCellIdx: number): void {
	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const aRow = Math.floor(anchorCellIdx / cellsPerRow);
	const aCol = anchorCellIdx - aRow * cellsPerRow;
	const fRow = Math.floor(focusCellIdx / cellsPerRow);
	const fCol = focusCellIdx - fRow * cellsPerRow;
	const minRow = Math.min(aRow, fRow);
	const maxRow = Math.max(aRow, fRow);
	const minCol = Math.min(aCol, fCol);
	const maxCol = Math.max(aCol, fCol);
	const rows = table.children!;
	for (let r = minRow; r <= maxRow; r++) {
		const row = rows[r];
		for (let c = minCol; c <= maxCol; c++) {
			row.children![c].raw = '';
		}
		rebuildTableRowRaw(row);
	}
}

// ── Shared deletion-path ceremony ───────────────────────────────────────────
// The cross-block cases interleave replaceAtPath differently (case 1 after
// deletes, case 2 before — see its ordering comment), so the steps stay
// separate helpers the cases sequence explicitly.

/** Strictly-between subtree roots, plus endpoint paths the caller marks for removal. */
function collectDeletionPaths(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endpointPaths: number[][]
): number[][] {
	const between = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	return [...between, ...endpointPaths];
}

/** Own every deletion path's parent spine before any splice (G1.9). */
function ownDeletionParents(doc: Document, deletionPaths: number[][], sharing: SharingState): void {
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}
}

/** Delete in reverse doc order so earlier indices don't shift later targets. */
function deleteInReverseDocOrder(doc: Document, deletionPaths: number[][]): void {
	const reverseSorted = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSorted) {
		deleteAtPath(doc, path);
	}
}

function cascadeCleanupAll(doc: Document, deletionPaths: number[][], lcaPath: number[]): void {
	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}
}

function rebuildDeletionAncestries(
	doc: Document,
	deletionPaths: number[][],
	sharing: SharingState
): void {
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing);
	}
}

// ── Case 1: prose start, table end ─────────────────────────────────────────

function deleteFromProseIntoTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	startBlock: CstNode,
	table: CstNode,
	sharing: SharingState
): RangeDeleteResult {
	const startRaw = startBlock.raw;
	const truncatedRaw = startRaw.slice(0, assertCharOffset(start, 'deleteFromProseIntoTable:start'));
	const truncatedReplacement = reparseWithFallback(truncatedRaw, startBlock.leadingTrivia);
	for (const node of truncatedReplacement) sharing.stamp(node);

	// end.offset is the whole-row-snapped inclusive last cell; deleteCellsAndCollapse
	// takes an exclusive end, so clearing the same rows the clipboard copied needs +1.
	const result = deleteCellsAndCollapse(table, 0, end.offset + 1);

	const deletionPaths = collectDeletionPaths(
		doc,
		start,
		end,
		result === 'tableEmpty' ? [end.path] : []
	);
	ownDeletionParents(doc, deletionPaths, sharing);
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	deleteInReverseDocOrder(doc, deletionPaths);
	replaceAtPath(doc, start.path, truncatedReplacement);
	cascadeCleanupAll(doc, deletionPaths, lcaPath);

	if (result === 'tableSurvives') rebuildOwnedContainer(table, sharing);
	rebuildUnsharedAncestry(doc, start.path, sharing);
	rebuildDeletionAncestries(doc, deletionPaths, sharing);
	if (result === 'tableSurvives') rebuildUnsharedAncestry(doc, survivorPath(doc, table), sharing);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
}

// ── Case 2: table start, prose end ─────────────────────────────────────────

function deleteFromTableIntoProse(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode,
	endBlock: CstNode,
	sharing: SharingState
): RangeDeleteResult {
	const lastCellIdx = totalCellCount(table);
	const tableResult = deleteCellsAndCollapse(table, start.offset, lastCellIdx);

	const endRaw = endBlock.raw;
	const lineEnding = endRaw.endsWith('\r\n') ? '\r\n' : '\n';
	const tailRaw = endRaw.slice(assertCharOffset(end, 'deleteFromTableIntoProse:end'));
	const survivingTailRaw = tailRaw.length === 0 ? lineEnding : tailRaw;
	const tailReplacement = reparseWithFallback(survivingTailRaw, endBlock.leadingTrivia);
	for (const node of tailReplacement) sharing.stamp(node);

	const deletionPaths = collectDeletionPaths(
		doc,
		start,
		end,
		tableResult === 'tableEmpty' ? [start.path] : []
	);
	ownDeletionParents(doc, deletionPaths, sharing);
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Replace end first: its path is later in doc order, so deleting strictly-
	// between doesn't shift it. Then delete strictly-between in reverse, then
	// optionally start.path.
	replaceAtPath(doc, end.path, tailReplacement);
	deleteInReverseDocOrder(doc, deletionPaths);
	cascadeCleanupAll(doc, deletionPaths, lcaPath);

	const tailPath = survivorPath(doc, tailReplacement[0]);

	if (tableResult === 'tableSurvives') {
		rebuildOwnedContainer(table, sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing);
	}
	rebuildUnsharedAncestry(doc, tailPath, sharing);
	rebuildDeletionAncestries(doc, deletionPaths, sharing);

	// Spec § Cross-block delete Case 2: when the table is fully consumed, the
	// caret lands at the start of the reparsed surviving tail — never the
	// deleted table; otherwise in the table's surviving anchor cell.
	const collapsedCaret: SelectionPoint =
		tableResult === 'tableEmpty'
			? { path: tailPath, offset: 0 }
			: survivingAnchorCellCaret(table, start.path, start.offset);

	return { newDoc: doc, collapsedCaret };
}

// Deep [...tablePath, row, col] caret into the surviving table's anchor cell:
// the cell is cleared from the anchor onward, so its end offset is its
// displayLength (0 when fully cleared). anchorCol === 0 means the anchor row
// itself was removed — fall back to the end of the previous row's last cell.
function survivingAnchorCellCaret(
	table: CstNode,
	startPath: number[],
	anchorCellIdx: number
): SelectionPoint {
	const cellsPerRow = metadataOf(table, 'table').columnCount;
	const anchorRow = Math.floor(anchorCellIdx / cellsPerRow);
	const anchorCol = anchorCellIdx - anchorRow * cellsPerRow;

	if (anchorCol > 0) {
		const cell = table.children![anchorRow].children![anchorCol];
		return { path: [...startPath, anchorRow, anchorCol], offset: displayLength(cell.raw) };
	}
	const survivorRow = anchorRow - 1;
	const survivorCol = cellsPerRow - 1;
	if (survivorRow < 0) {
		// Defensive: anchor was in row 0 and that row was removed. Not reached by
		// current callers (they collapse to 'tableEmpty' first), but the contract
		// must not index table.children[-1].
		return { path: [...startPath, 0, 0], offset: 0 };
	}
	const survivor = table.children![survivorRow].children![survivorCol];
	return { path: [...startPath, survivorRow, survivorCol], offset: displayLength(survivor.raw) };
}

// ── Case 1+2 hybrid: both endpoints are tables ─────────────────────────────

function deleteAcrossTwoTables(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	startTable: CstNode,
	endTable: CstNode,
	sharing: SharingState
): RangeDeleteResult {
	const startResult = deleteCellsAndCollapse(startTable, start.offset, totalCellCount(startTable));
	// end.offset is the whole-row-snapped inclusive last cell; +1 for the exclusive end.
	const endResult = deleteCellsAndCollapse(endTable, 0, end.offset + 1);

	const emptiedEndpoints: number[][] = [];
	if (startResult === 'tableEmpty') emptiedEndpoints.push(start.path);
	if (endResult === 'tableEmpty') emptiedEndpoints.push(end.path);
	const deletionPaths = collectDeletionPaths(doc, start, end, emptiedEndpoints);
	ownDeletionParents(doc, deletionPaths, sharing);
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	deleteInReverseDocOrder(doc, deletionPaths);
	cascadeCleanupAll(doc, deletionPaths, lcaPath);

	const endTablePath = endResult === 'tableSurvives' ? survivorPath(doc, endTable) : null;

	if (startResult === 'tableSurvives') {
		rebuildOwnedContainer(startTable, sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing);
	}
	if (endTablePath) {
		rebuildOwnedContainer(endTable, sharing);
		rebuildUnsharedAncestry(doc, endTablePath, sharing);
	}
	rebuildDeletionAncestries(doc, deletionPaths, sharing);

	let collapsedCaret: SelectionPoint;
	if (startResult === 'tableSurvives') {
		// Start table keeps its slot (deletions are all at or after start.path).
		collapsedCaret = survivingAnchorCellCaret(startTable, start.path, start.offset);
	} else if (endTablePath) {
		// Start emptied → its block removed and the end table shifted. Land in
		// its first surviving cell (row 0, col 0).
		collapsedCaret = { path: [...endTablePath, 0, 0], offset: 0 };
	} else {
		// Both tables removed.
		collapsedCaret = caretAfterBothTablesRemoved(doc, start.path, sharing);
	}

	return { newDoc: doc, collapsedCaret };
}

// Both tables across the range were removed. Anchor-side convention: prefer
// the end of the nearest surviving block before the deleted range; else the
// start of the first surviving block after it; else materialize an empty
// paragraph (the document emptied — mirrors the prose rangeDelete fallback).
// Adjacent surviving tables get deep cell carets, never a shallow table path.
function caretAfterBothTablesRemoved(
	doc: Document,
	startPath: number[],
	sharing: SharingState
): SelectionPoint {
	const children = doc.children;
	const beforeIdx = startPath[0] - 1;

	if (beforeIdx >= 0) {
		const before = children[beforeIdx];
		if (before.kind === 'table') return lastCellCaret(before, [beforeIdx]);
		return { path: [beforeIdx], offset: displayLength(before.raw) };
	}
	if (children.length > 0) {
		return children[0].kind === 'table' ? { path: [0, 0, 0], offset: 0 } : { path: [0], offset: 0 };
	}

	const filler: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
	sharing.stamp(filler);
	doc.children.push(filler);
	return { path: [0], offset: 0 };
}

function lastCellCaret(table: CstNode, tablePath: number[]): SelectionPoint {
	const lastRow = table.children!.length - 1;
	const lastCol = metadataOf(table, 'table').columnCount - 1;
	const cell = table.children![lastRow].children![lastCol];
	return { path: [...tablePath, lastRow, lastCol], offset: displayLength(cell.raw) };
}

// ── Post-delete path resolution ────────────────────────────────────────────

// Deletions and ancestor cleanup shift sibling indices at arbitrary depths, so
// surviving blocks are located by identity instead of index arithmetic.
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

/**
 * Clear cells in `[startCellIdx, endCellIdx)`, remove rows where every cell
 * is in the range, and promote the next surviving row to header when row 0
 * goes. Mutates in place. Returns whether the table itself should be
 * removed (no rows remain).
 */
function deleteCellsAndCollapse(
	table: CstNode,
	startCellIdx: number,
	endCellIdx: number
): ClearResult {
	if (startCellIdx >= endCellIdx) return 'tableSurvives';
	clearCellsInRange(table, startCellIdx, endCellIdx);

	const meta = metadataOf(table, 'table');
	const rows = table.children!;
	const cellsPerRow = meta.columnCount;

	const startRow = Math.floor(startCellIdx / cellsPerRow);
	const startCol = startCellIdx - startRow * cellsPerRow;
	const lastRowInRange = Math.floor((endCellIdx - 1) / cellsPerRow);
	const lastColInRange = endCellIdx - 1 - lastRowInRange * cellsPerRow;

	// First range row is fully covered iff startCol === 0; last iff
	// lastColInRange === cellsPerRow - 1; middle rows always are.
	const firstFull = startCol === 0 ? startRow : startRow + 1;
	const lastFull = lastColInRange === cellsPerRow - 1 ? lastRowInRange : lastRowInRange - 1;

	const headerRemoved = firstFull <= 0 && lastFull >= 0;

	if (firstFull <= lastFull) {
		rows.splice(firstFull, lastFull - firstFull + 1);
	}

	if (rows.length === 0) return 'tableEmpty';
	if (headerRemoved) {
		metadataOf(rows[0], 'tableRow').isHeader = true;
	}
	return 'tableSurvives';
}

function clearCellsInRange(table: CstNode, startCellIdx: number, endCellIdx: number): void {
	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const rows = table.children!;
	const touchedRows = new Set<number>();
	for (let i = startCellIdx; i < endCellIdx; i++) {
		const r = Math.floor(i / cellsPerRow);
		const c = i - r * cellsPerRow;
		rows[r].children![c].raw = '';
		touchedRows.add(r);
	}
	for (const r of touchedRows) rebuildTableRowRaw(rows[r]);
}

function totalCellCount(table: CstNode): number {
	const meta = metadataOf(table, 'table');
	return (table.children?.length ?? 0) * meta.columnCount;
}

function reparseWithFallback(raw: string, leadingTrivia: string): CstNode[] {
	const reparsed = parse(raw || '\n');
	if (reparsed.children.length === 0) {
		return [{ kind: 'paragraph', leadingTrivia, raw: '\n' }];
	}
	const cloned = reparsed.children.slice();
	cloned[0] = { ...cloned[0], leadingTrivia };
	return cloned;
}
