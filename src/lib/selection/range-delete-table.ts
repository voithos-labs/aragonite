/**
 * The `rangeDelete` branches for tables, whose selection offsets are cell indices, so no text
 * merges: a pair inside one table clears the cells it holds, and a kept table edge of a longer
 * range loses the whole rows the range covers.
 */

import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import {
	isChromeChild,
	nearestChromeContainer,
	type GridCoverage,
	type RangeCoverage
} from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength } from '../core/lines';
import { cellRowCol } from '../cursor/coordinate-spaces';
import { cellIndexOf } from './primitives';
import {
	planCrossBlockDeletion,
	applyPlannedDeletion,
	rebuildSharedAncestries,
	truncateEndInPlace,
	truncateStartInPlace
} from './range-delete-ceremony';
import { ensureUnsharedPath, ensureUnsharedSubtree } from '../tree-operations/unshare';
import { attachedChainPrefix, rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import { rebuildTableRowRaw } from '../schema/container-rebuilders';
import { promoteFirstRowToHeader } from '../tree-operations/table-mutations';
import { caretWhereRangeResumes } from './range-delete-chrome';
import { assertInvariant } from '../assert';

// ── Public API ──────────────────────────────────────────────────────────────

/** Whether an edge the range keeps sits on a table, so its rows are cut rather than its text. */
export function keepsTableEdge(coverage: RangeCoverage): boolean {
	return coverage.startCells !== null || coverage.endCells !== null;
}

/** Clears the cells a pair inside one table holds, keeping the table's rows and columns; the
 *  caret goes in the start cell, so a follow-up paste or typed text lands inside the table. */
export function clearGridCells(
	doc: Document,
	coverage: RangeCoverage,
	grid: GridCoverage,
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const chain = ensureUnsharedPath(doc, grid.path, sharing);
	const table = chain[chain.length - 1];
	ensureUnsharedSubtree(table, sharing);
	const { top, left, rows, cols } = grid.rect;
	for (let r = top; r < top + rows; r++) {
		const row = table.children![r];
		for (let c = left; c < left + cols; c++) row.children![c].raw = '';
		rebuildTableRowRaw(row);
	}
	rebuildUnsharedChain(doc, chain, sharing, null, reading.grammar);

	const columnCount = metadataOf(table, 'table').columnCount;
	const { row, col } = cellRowCol(
		cellIndexOf(coverage.range.start, 'clearGridCells:start'),
		columnCount
	);
	const anchor = { path: [...grid.path, row, col], offset: 0 };
	return { newDoc: doc, caret: () => anchor, tableRowSplices: [] };
}

/** Deletes a range that keeps a table edge: that table loses the rows from the start's row on,
 *  or up to the end's; a kept text edge is truncated in place and what lies between goes. */
export function tableAwareRangeDelete(
	doc: Document,
	coverage: RangeCoverage,
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const { grammar } = reading;
	const { start, end } = coverage.range;
	const { startEdge, endEdge } = coverage;

	// Copy both kept endpoint chains, and a kept table's whole subtree (cell raws, row splices and
	// the header promotion all write at depth), before any capture or mutation.
	const startChain = startEdge ? ensureUnsharedPath(doc, start.path, sharing) : null;
	const endChain = endEdge ? ensureUnsharedPath(doc, end.path, sharing) : null;
	const startBlock = startChain?.[startChain.length - 1] ?? null;
	const endBlock = endChain?.[endChain.length - 1] ?? null;
	const { startCells, endCells } = coverage;
	const startTable = startCells ? startBlock : null;
	const endTable = endCells ? endBlock : null;
	if (startTable) ensureUnsharedSubtree(startTable, sharing);
	if (endTable) ensureUnsharedSubtree(endTable, sharing);

	const startSplice =
		startTable && startCells
			? deleteCellsAndCollapse(startTable, startCells.from, startCells.to)
			: null;
	const endSplice =
		endTable && endCells ? deleteCellsAndCollapse(endTable, endCells.from, endCells.to) : null;

	const plan = planCrossBlockDeletion(doc, coverage, [], sharing);
	// A kept text end truncates first, while its path is still valid, and never merges.
	if (endBlock && !endTable) {
		const endC = nearestChromeContainer(doc, end.path);
		truncateEndInPlace(
			doc,
			end,
			endBlock,
			endC !== null && isChromeChild(endC, end.path),
			reading,
			sharing,
			'tableAwareRangeDelete:end'
		);
	}
	applyPlannedDeletion(doc, plan, grammar);
	// Every deletion sits after the start in document order, so its path is still live.
	let seam: number | null = null;
	if (startBlock && !startTable) {
		const startC = nearestChromeContainer(doc, start.path);
		seam = truncateStartInPlace(
			doc,
			start,
			startBlock,
			startC !== null && isChromeChild(startC, start.path),
			reading,
			sharing,
			'tableAwareRangeDelete:start'
		);
	}

	for (const chain of [startChain, endChain]) {
		const attached = chain ? attachedChainPrefix(doc, chain) : [];
		if (attached.length > 0) rebuildUnsharedChain(doc, attached, sharing, null, grammar);
	}
	rebuildSharedAncestries(doc, plan, sharing, grammar);

	const tableRowSplices = [
		...(startTable && startSplice ? [{ table: startTable, ...startSplice }] : []),
		...(endTable && endSplice ? [{ table: endTable, ...endSplice }] : [])
	];
	const kept: SelectionPoint | null =
		startTable && startCells
			? survivingAnchorCellCaret(startTable, start.path, startCells.from)
			: seam !== null
				? { path: start.path.slice(), offset: seam }
				: null;
	const resumeFrom = coverage.rootHolding(start.path) ?? start.path;
	return {
		newDoc: doc,
		caret: kept ? () => kept : (committed) => caretWhereRangeResumes(committed, resumeFrom),
		tableRowSplices
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

// The caret in the surviving start table's anchor cell, cleared from the anchor on, so at its end;
// an anchor in column 0 lost its row, so the last cell of the row above.
function survivingAnchorCellCaret(
	table: CstNode,
	startPath: number[],
	anchorCellIdx: number
): SelectionPoint {
	const cellsPerRow = metadataOf(table, 'table').columnCount;
	const anchor = cellRowCol(anchorCellIdx, cellsPerRow);
	const at = anchor.col > 0 ? anchor : { row: Math.max(anchor.row - 1, 0), col: cellsPerRow - 1 };
	// A start table losing its first row is one the range holds whole, never a kept edge.
	assertInvariant('kept-table-edge', () =>
		anchor.col > 0 || anchor.row > 0
			? null
			: { code: 'kept-table-edge', message: 'a kept start table lost its first row' }
	);
	const cell = table.children![at.row].children![at.col];
	return { path: [...startPath, at.row, at.col], offset: displayLength(cell.raw) };
}

// ── Cell-range cleanup ─────────────────────────────────────────────────────

type RowSplice = { at: number; count: number };

/** Clears the cells in `[startCellIdx, endCellIdx)` and removes the rows fully inside it,
 *  returning the row window spliced, so the commit can sync row state. */
function deleteCellsAndCollapse(
	table: CstNode,
	startCellIdx: number,
	endCellIdx: number
): RowSplice | null {
	if (startCellIdx >= endCellIdx) return null;
	clearCellsInRange(table, startCellIdx, endCellIdx);

	const cellsPerRow = metadataOf(table, 'table').columnCount;
	const { row: startRow, col: startCol } = cellRowCol(startCellIdx, cellsPerRow);
	const { row: lastRow, col: lastCol } = cellRowCol(endCellIdx - 1, cellsPerRow);
	const firstFull = startCol === 0 ? startRow : startRow + 1;
	const lastFull = lastCol === cellsPerRow - 1 ? lastRow : lastRow - 1;
	if (firstFull > lastFull) return null;

	table.children!.splice(firstFull, lastFull - firstFull + 1);
	if (firstFull === 0) promoteFirstRowToHeader(table);
	return { at: firstFull, count: lastFull - firstFull + 1 };
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
