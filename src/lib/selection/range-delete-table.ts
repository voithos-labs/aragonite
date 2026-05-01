/**
 * Table-aware branch of rangeDelete: tables encode selection offsets as cell
 * indices, so prose raw-merge doesn't apply.
 */

import type { CstNode, Document, TableMetadata, TableRowMetadata } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import { parse } from '../core/parser';
import { displayLength } from '../core/lines';
import { walkBetween, comparePaths } from './primitives';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import { lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import {
	rebuildAncestryRawForLeaf,
	rebuildContainerRaw,
	rebuildTableRowRaw
} from '../schema/container-raw';

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
	startBlock: CstNode,
	endBlock: CstNode
): RangeDeleteResult {
	const sameBlock = comparePaths(start.path, end.path) === 0;

	if (sameBlock) {
		return deleteWithinTable(doc, start, end, startBlock);
	}
	if (startBlock.kind === 'table' && endBlock.kind === 'table') {
		return deleteAcrossTwoTables(doc, start, end, startBlock, endBlock);
	}
	if (startBlock.kind === 'table') {
		return deleteFromTableIntoProse(doc, start, end, startBlock, endBlock);
	}
	return deleteFromProseIntoTable(doc, start, end, startBlock, endBlock);
}

// ── Same-block: whole-table or partial-table intra-table ───────────────────

// Caret returns as a deep [...tablePath, anchorRow, anchorCol] path so the
// follow-up paste / focus restore lands inside the anchor cell's contenteditable
// instead of the table wrapper.
function deleteWithinTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode
): RangeDeleteResult {
	clearRectangularCells(table, start.offset, end.offset);
	rebuildContainerRaw(table);
	rebuildAncestryRawForLeaf(doc, start.path);

	const meta = table.metadata as TableMetadata;
	const cellsPerRow = meta.columnCount;
	const anchorRow = Math.floor(start.offset / cellsPerRow);
	const anchorCol = start.offset - anchorRow * cellsPerRow;

	return {
		newDoc: doc,
		collapsedCaret: { path: [...start.path, anchorRow, anchorCol], offset: 0 }
	};
}

function clearRectangularCells(table: CstNode, anchorCellIdx: number, focusCellIdx: number): void {
	const meta = table.metadata as TableMetadata;
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

// ── Case 1: prose start, table end ─────────────────────────────────────────

function deleteFromProseIntoTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	startBlock: CstNode,
	table: CstNode
): RangeDeleteResult {
	const startRaw = startBlock.raw;
	const truncatedRaw = startRaw.slice(0, start.offset);
	const truncatedReplacement = reparseWithFallback(truncatedRaw, startBlock.leadingTrivia);

	const result = deleteCellsAndCollapse(table, 0, end.offset);

	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths];
	if (result === 'tableEmpty') deletionPaths.push(end.path);

	const lcaPath = lowestCommonAncestor(start.path, end.path);
	const reverseSorted = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSorted) {
		deleteAtPath(doc, path);
	}

	replaceAtPath(doc, start.path, truncatedReplacement);

	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	if (result === 'tableSurvives') rebuildContainerRaw(table);
	rebuildAncestryRawForLeaf(doc, start.path);
	for (const path of deletionPaths) {
		rebuildAncestryRawForLeaf(doc, path);
	}
	if (result === 'tableSurvives') rebuildAncestryRawForLeaf(doc, end.path);

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
	endBlock: CstNode
): RangeDeleteResult {
	const lastCellIdx = totalCellCount(table);
	const tableResult = deleteCellsAndCollapse(table, start.offset, lastCellIdx);

	const endRaw = endBlock.raw;
	const lineEnding = endRaw.endsWith('\r\n') ? '\r\n' : '\n';
	const tailRaw = endRaw.slice(end.offset);
	const survivingTailRaw = tailRaw.length === 0 ? lineEnding : tailRaw;
	const tailReplacement = reparseWithFallback(survivingTailRaw, endBlock.leadingTrivia);

	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths];
	if (tableResult === 'tableEmpty') deletionPaths.push(start.path);

	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Replace end first: its path is later in doc order, so deleting strictly-
	// between doesn't shift it. Then delete strictly-between in reverse, then
	// optionally start.path.
	replaceAtPath(doc, end.path, tailReplacement);

	const reverseSorted = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSorted) {
		deleteAtPath(doc, path);
	}

	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	if (tableResult === 'tableSurvives') {
		rebuildContainerRaw(table);
		rebuildAncestryRawForLeaf(doc, start.path);
	}
	rebuildAncestryRawForLeaf(doc, end.path);
	for (const path of deletionPaths) {
		rebuildAncestryRawForLeaf(doc, path);
	}

	return {
		newDoc: doc,
		collapsedCaret: caretForCase2(table, start, tableResult)
	};
}

// Spec § Cross-block delete Case 2: cursor lands at "end of surviving anchor
// cell content"; if the anchor row was removed, fall back to end of the last
// cell of row r-1. The surviving anchor cell is empty (Case 2 always clears
// from the anchor cell onward), so the offset there is 0 — but we still need
// the deep [tablePath, rowIdx, colIdx] path so the caret-restore lands inside
// the cell's contenteditable, not on the table's outer wrapper.
function caretForCase2(table: CstNode, start: SelectionPoint, result: ClearResult): SelectionPoint {
	if (result === 'tableEmpty') {
		return { path: start.path.slice(), offset: start.offset };
	}
	const meta = table.metadata as TableMetadata;
	const cellsPerRow = meta.columnCount;
	const anchorRow = Math.floor(start.offset / cellsPerRow);
	const anchorCol = start.offset - anchorRow * cellsPerRow;

	if (anchorCol > 0) {
		const cell = table.children![anchorRow].children![anchorCol];
		return {
			path: [...start.path, anchorRow, anchorCol],
			offset: displayLength(cell.raw)
		};
	}
	const survivorRow = anchorRow - 1;
	const survivorCol = cellsPerRow - 1;
	const survivor = table.children![survivorRow].children![survivorCol];
	return {
		path: [...start.path, survivorRow, survivorCol],
		offset: displayLength(survivor.raw)
	};
}

// ── Case 1+2 hybrid: both endpoints are tables ─────────────────────────────

function deleteAcrossTwoTables(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	startTable: CstNode,
	endTable: CstNode
): RangeDeleteResult {
	const startResult = deleteCellsAndCollapse(startTable, start.offset, totalCellCount(startTable));
	const endResult = deleteCellsAndCollapse(endTable, 0, end.offset);

	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths];
	if (startResult === 'tableEmpty') deletionPaths.push(start.path);
	if (endResult === 'tableEmpty') deletionPaths.push(end.path);

	const lcaPath = lowestCommonAncestor(start.path, end.path);
	const reverseSorted = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSorted) {
		deleteAtPath(doc, path);
	}

	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	if (startResult === 'tableSurvives') {
		rebuildContainerRaw(startTable);
		rebuildAncestryRawForLeaf(doc, start.path);
	}
	if (endResult === 'tableSurvives') {
		rebuildContainerRaw(endTable);
		rebuildAncestryRawForLeaf(doc, end.path);
	}
	for (const path of deletionPaths) {
		rebuildAncestryRawForLeaf(doc, path);
	}

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
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

	const meta = table.metadata as TableMetadata;
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
		(rows[0].metadata as TableRowMetadata).isHeader = true;
	}
	return 'tableSurvives';
}

function clearCellsInRange(table: CstNode, startCellIdx: number, endCellIdx: number): void {
	const meta = table.metadata as TableMetadata;
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
	const meta = table.metadata as TableMetadata;
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
