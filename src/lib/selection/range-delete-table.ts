/**
 * Table-aware branch of rangeDelete. Tables encode their selection offset as
 * a cell index (`rowIdx * columnCount + colIdx`) rather than a character
 * offset, so the standard `mergedRaw = startRaw.slice(0, start.offset) +
 * endRaw.slice(end.offset)` would corrupt the table. Instead, this module
 * clears cells in-place and removes fully-covered rows, with no merge across
 * the prose↔table boundary.
 *
 * Three cross-block shapes plus one same-block shape — see the
 * "Cross-block delete" section of the table block design spec.
 */

import type { CstNode, Document, TableMetadata, TableRowMetadata } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import { parse } from '../core/parser';
import { walkBetween, comparePaths } from './primitives';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { nodeAt } from '../tree-operations/node-ops';
import { pathHasPrefix } from './path-math';
import {
	rebuildAncestryRawForLeaf,
	rebuildContainerRaw
} from '../schema/container-raw';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * True when either endpoint resolves to a table block. Table-as-start and
 * table-as-end use cell-index offset semantics, so the standard rangeDelete
 * raw-merge path doesn't apply.
 */
export function involvesTable(startBlock: CstNode, endBlock: CstNode): boolean {
	return startBlock.kind === 'table' || endBlock.kind === 'table';
}

/**
 * Run the table-aware range delete. Caller has already resolved
 * startBlock/endBlock and confirmed at least one endpoint is a table.
 */
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
		// Two distinct tables (no nesting between them) — treat as two prose
		// endpoints would: clear tail-portion of start table, head-portion of
		// end table, delete blocks strictly between, no merge.
		return deleteAcrossTwoTables(doc, start, end, startBlock, endBlock);
	}
	if (startBlock.kind === 'table') {
		return deleteFromTableIntoProse(doc, start, end, startBlock, endBlock);
	}
	return deleteFromProseIntoTable(doc, start, end, startBlock, endBlock);
}

// ── Same-block: whole-table or partial-table intra-table ───────────────────

/**
 * start.path === end.path === tablePath. Intra-table multi-cell selection
 * is rectangular (per spec § "Two encodings"): both offsets are inclusive
 * cell indices and the cleared region is the rectangle bounded by their
 * (row, col) corners. Structure is always preserved — removing rows/columns
 * requires extending the selection outside the table boundary, which routes
 * through Case 1/2/3.
 */
function deleteWithinTable(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode
): RangeDeleteResult {
	clearRectangularCells(table, start.offset, end.offset);
	rebuildContainerRaw(table);
	rebuildAncestryRawForLeaf(doc, start.path);
	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
}

/** Clear cells in the rectangle bounded by anchor and focus cell indices (inclusive). */
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
		if (!row) continue;
		for (let c = minCol; c <= maxCol; c++) {
			const cell = row.children?.[c];
			if (cell) cell.raw = '';
		}
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

	// Splice deletion-targets in reverse doc-order so earlier paths stay valid.
	// Skip descendants of start/end — those endpoints handle their own internal
	// mutation; walkBetween's descent into the table would otherwise enumerate
	// every row/cell as a "between" path and cascade-cleanup would then delete
	// the now-emptied table.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter(
		(p) => !pathHasPrefix(p, start.path) && !pathHasPrefix(p, end.path)
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

	// See deleteFromProseIntoTable for the descendant filter rationale.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter(
		(p) => !pathHasPrefix(p, start.path) && !pathHasPrefix(p, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths];
	if (tableResult === 'tableEmpty') deletionPaths.push(start.path);

	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Replace end first (its path is later in doc order so deletion of
	// strictly-between doesn't shift it). Then delete strictly-between in
	// reverse, then optionally delete start.path.
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

	// Caret: end of surviving start cell. If the start cell itself survived
	// (start.offset's cell wasn't cleared), the caret falls on it; otherwise
	// fall back to start.path/start.offset, which the caller's focus
	// dispatcher clamps via path lookup.
	return {
		newDoc: doc,
		collapsedCaret: caretForCase2(table, start, tableResult)
	};
}

function caretForCase2(
	table: CstNode,
	start: SelectionPoint,
	result: ClearResult
): SelectionPoint {
	if (result === 'tableEmpty') {
		return { path: start.path.slice(), offset: start.offset };
	}
	const remainingCells = totalCellCount(table);
	const clampedOffset = Math.min(start.offset, remainingCells);
	return { path: start.path.slice(), offset: clampedOffset };
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

	const betweenPaths = walkBetween(doc, start.path, end.path).filter(
		(p) => !pathHasPrefix(p, start.path) && !pathHasPrefix(p, end.path)
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
	const lastColInRange = (endCellIdx - 1) - lastRowInRange * cellsPerRow;

	// A row goes only when every one of its columns is covered. The first row
	// of the range is fully covered iff startCol === 0; the last is fully
	// covered iff lastColInRange === cellsPerRow - 1; all middle rows are
	// fully covered.
	const firstFull = startCol === 0 ? startRow : startRow + 1;
	const lastFull =
		lastColInRange === cellsPerRow - 1 ? lastRowInRange : lastRowInRange - 1;

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
	for (let i = startCellIdx; i < endCellIdx; i++) {
		const r = Math.floor(i / cellsPerRow);
		const c = i - r * cellsPerRow;
		const row = rows[r];
		if (!row) continue;
		const cell = row.children?.[c];
		if (!cell) continue;
		cell.raw = '';
	}
}

function totalCellCount(table: CstNode): number {
	const meta = table.metadata as TableMetadata;
	return (table.children?.length ?? 0) * meta.columnCount;
}

// ── Local copies of range-delete's structural helpers ──────────────────────
// rangeDelete keeps these private; duplicating here avoids broadening that
// module's surface area for one consumer.

function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		parent.children.splice(idx, 1);
	}
}

function replaceAtPath(doc: Document, path: number[], replacement: CstNode[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	parent.children.splice(idx, 1, ...replacement);
}

function lowestCommonAncestor(a: number[], b: number[]): number[] {
	const result: number[] = [];
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) break;
		result.push(a[i]);
	}
	return result;
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
