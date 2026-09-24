/**
 * The `rangeDelete` branch for a table endpoint: a table's selection offsets are cell indices,
 * so the text merge does not apply. Surviving blocks are found afterwards by scanning for the
 * node ({@link survivorPath}) rather than by index arithmetic, because deletions and cleanup
 * shift sibling indices at any depth. One scan per delete, on a Backspace or Delete keystroke,
 * so the linear cost is accepted.
 */

import type { GrammarView } from '../schema/block-openers';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength, trailingLineEnding } from '../core/lines';
import { cellRowCol } from '../cursor/coordinate-spaces';
import { cellIndexOf } from './primitives';
import {
	resolveEndWall,
	planCrossBlockDeletion,
	applyPlannedDeletion,
	rebuildSharedAncestries,
	truncateEndInPlace,
	truncateStartInPlace,
	type LiveSeamContext
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
import { isCollapsedContainer } from '../schema/reserved-chrome';
import { nearestChromeContainer, isChromeChild } from './range-delete-chrome';

// ── Public API ──────────────────────────────────────────────────────────────

export function involvesTable(startBlock: CstNode, endBlock: CstNode): boolean {
	return startBlock.kind === 'table' || endBlock.kind === 'table';
}

export function tableAwareRangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	presentationMode?: PresentationMode,
	linkRef?: InlineResolverRef
): RangeDeleteResult {
	const sameBlock = comparePaths(start.path, end.path) === 0;
	const live = { presentationMode, linkRef };

	// Copy both endpoint chains (and the table subtrees: cell raws, row splices, and header
	// promotion all write at depth) before any capture or mutation.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const startBlock = startChain[startChain.length - 1] ?? ownedEndpoint(doc, start.path, sharing);
	const endBlock = sameBlock
		? startBlock
		: (ensureUnsharedPath(doc, end.path, sharing).pop() ?? ownedEndpoint(doc, end.path, sharing));
	if (startBlock.kind === 'table') ensureUnsharedSubtree(startBlock, sharing);
	if (!sameBlock && endBlock.kind === 'table') ensureUnsharedSubtree(endBlock, sharing);

	if (sameBlock) {
		return deleteWithinTable(doc, start, end, startBlock, sharing, grammar);
	}
	if (startBlock.kind === 'table' && endBlock.kind === 'table') {
		return deleteAcrossTwoTables(doc, start, end, startBlock, endBlock, sharing, grammar);
	}
	if (startBlock.kind === 'table') {
		return deleteFromTableIntoProse(doc, start, end, startBlock, endBlock, sharing, grammar, live);
	}
	return deleteFromProseIntoTable(doc, start, end, startBlock, endBlock, sharing, grammar, live);
}

/**
 * The copied node for an endpoint whose chain came back short, through `ensureUnsharedNode`
 * rather than a bare reference into the live tree. A miss here is a caller bug.
 */
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
	grammar: GrammarView | undefined
): RangeDeleteResult {
	// Endpoints inside one table share its path and are not flagged, so `.offset` reads directly;
	// `cellIndexOf` would warn for nothing here.
	clearRectangularCells(table, start.offset, end.offset);
	rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);

	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const { row: anchorRow, col: anchorCol } = cellRowCol(start.offset, cellsPerRow);

	return {
		newDoc: doc,
		collapsedCaret: { path: [...start.path, anchorRow, anchorCol], offset: 0 },
		tableRowSplices: []
	};
}

function clearRectangularCells(table: CstNode, anchorCellIdx: number, focusCellIdx: number): void {
	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const { row: aRow, col: aCol } = cellRowCol(anchorCellIdx, cellsPerRow);
	const { row: fRow, col: fCol } = cellRowCol(focusCellIdx, cellsPerRow);
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
	table: CstNode,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	live: LiveSeamContext
): RangeDeleteResult {
	const startC = nearestChromeContainer(doc, start.path);
	const startIsChrome = startC !== null && isChromeChild(startC, start.path);

	// The snapped end cell is the whole-row inclusive last cell; deleteCellsAndCollapse takes an
	// exclusive end, so +1 clears the same rows the clipboard copied.
	const { result, splice } = deleteCellsAndCollapse(
		table,
		0,
		cellIndexOf(end, 'deleteFromProseIntoTable:end') + 1
	);

	const wall = resolveEndWall(doc, start, end, result === 'tableEmpty');
	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		start,
		end,
		result === 'tableEmpty' ? [end.path] : [],
		wall,
		sharing
	);

	applyPlannedDeletion(doc, plan, lcaPath);
	const seam = truncateStartInPlace(
		doc,
		start,
		startBlock,
		startIsChrome,
		live,
		sharing,
		grammar,
		'deleteFromProseIntoTable:start'
	);

	const tableSurvives = result === 'tableSurvives';
	if (tableSurvives) rebuildOwnedContainer(table, sharing);
	rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	rebuildSharedAncestries(doc, plan, sharing, grammar);
	if (tableSurvives) rebuildUnsharedAncestry(doc, survivorPath(doc, table), sharing, null, grammar);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: seam },
		tableRowSplices: splice ? [{ table, ...splice }] : []
	};
}

// ── Case 2: table start, prose end ─────────────────────────────────────────

function deleteFromTableIntoProse(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	table: CstNode,
	endBlock: CstNode,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	live: LiveSeamContext
): RangeDeleteResult {
	const lineEnding = trailingLineEnding(table.raw);
	const startCell = cellIndexOf(start, 'deleteFromTableIntoProse:start');
	const { result: tableResult, splice } = deleteCellsAndCollapse(
		table,
		startCell,
		totalCellCount(table)
	);

	const wall = resolveEndWall(doc, start, end, null);
	const consumed = wall?.consumed ?? false;
	const endIsChrome = wall !== null && !consumed && isChromeChild(wall.container, end.path);

	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		start,
		end,
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
				live,
				sharing,
				grammar,
				'deleteFromTableIntoProse:end'
			);
	applyPlannedDeletion(doc, plan, lcaPath);

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

// Deep [...tablePath, row, col] caret into the surviving table's anchor cell: the cell is
// cleared from the anchor onward, so its end offset is its displayLength. anchorCol === 0 means
// the anchor row itself was removed, so fall back to the previous row's last cell.
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
		// Defensive: anchor in row 0 and that row removed. Callers collapse to 'tableEmpty'
		// first, but the contract must not index table.children[-1].
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
	sharing: SharingState,
	grammar: GrammarView | undefined
): RangeDeleteResult {
	const lineEnding = trailingLineEnding(startTable.raw);
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

	const wall = resolveEndWall(doc, start, end, endResult === 'tableEmpty');
	const emptiedEndpoints: number[][] = [];
	if (startResult === 'tableEmpty') emptiedEndpoints.push(start.path);
	if (endResult === 'tableEmpty') emptiedEndpoints.push(end.path);
	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		start,
		end,
		emptiedEndpoints,
		wall,
		sharing
	);

	applyPlannedDeletion(doc, plan, lcaPath);

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

// Every block the caret could land in was removed, so a survivor is sought in the deleted
// block's own container, walking outward when the cleanup took that too. `lineEnding` is the
// deleted start table's, captured before the mutation: nothing survives to read one from, and a
// default LF would turn a CRLF document (G4.20).
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
// 0 for a collapsed container, whose title line is all that shows. The test is whether the leaf
// can take focus, not whether it can merge: a fenced code leaf is editable but not mergeable,
// and the merge walk would leave the caret on the container's own path.
function survivorEndCaret(node: CstNode, path: number[]): SelectionPoint {
	let leaf = node;
	const leafPath = path.slice();
	while (leaf.children && leaf.children.length > 0) {
		const next = isCollapsedContainer(leaf) ? 0 : leaf.children.length - 1;
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

/**
 * Clear cells in `[startCellIdx, endCellIdx)`, remove rows fully inside the range, promote the
 * next surviving row to header when row 0 goes. Mutates in place. Reports whether the table
 * itself should be removed and the row window it spliced, so the commit can sync row state.
 */
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
