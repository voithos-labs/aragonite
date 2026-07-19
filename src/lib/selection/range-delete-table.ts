/**
 * Table-aware branch of rangeDelete: tables encode selection offsets as cell
 * indices, so prose raw-merge doesn't apply.
 *
 * Post-delete survivors are located by identity scan ({@link survivorPath}), not
 * index arithmetic — deletions and cascade cleanup shift sibling indices at
 * arbitrary depths, so any captured index goes stale. Each cross-block delete
 * runs at most one such scan, over the POST-delete tree, early-exiting at the
 * survivor: cost is O(the survivor's document-order position), bounded by
 * O(nodes). This rides the cold Backspace/Delete gesture, never a per-keystroke
 * path, so the linear scan is an accepted correctness-first cost.
 */

import type { CstNode, Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength } from '../core/lines';
import { walkBetween, charOffsetOf, cellIndexOf } from './primitives';
import { replaceAtPath } from '../tree-operations/path-mutate';
import { filterToSubtreeRoots, deleteSubtreesIdentityGated } from './range-delete-ceremony';
import {
	comparePaths,
	lowestCommonAncestor,
	isPathSubtreeBetween,
	pathHasPrefix,
	pathsEqual
} from './path-math';
import { blockNodeAt } from '../tree-operations/node-ops';
import {
	ensureUnsharedNode,
	ensureUnsharedPath,
	ensureUnsharedSubtree,
	rebuildOwnedContainer,
	rebuildUnsharedAncestry,
	rebuildUnsharedChain
} from '../tree-operations/unshare';
import { rebuildTableRowRaw } from '../schema/container-rebuilders';
import { findMergeTarget } from '../schema/merge-rules';
import {
	nearestChromeContainer,
	isChromeChild,
	rangeConsumesContainer,
	lastChildDescendant,
	lineEndingOf,
	terminateLine,
	reparseWithFallback,
	type ChromeContainer
} from './range-delete-chrome';

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
	const startBlock = startChain[startChain.length - 1] ?? ownedEndpoint(doc, start.path, sharing);
	const endBlock = sameBlock
		? startBlock
		: (ensureUnsharedPath(doc, end.path, sharing).pop() ?? ownedEndpoint(doc, end.path, sharing));
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

/**
 * Owned fallback for an endpoint whose unshare chain came back short — routes
 * through the unshare seam, never a raw live-tree capture. The dispatcher
 * resolved both endpoints, so a miss here is a genuine caller bug.
 */
function ownedEndpoint(doc: Document, path: number[], sharing: SharingState): CstNode {
	const node = blockNodeAt(doc, path);
	if (!node) throw new Error('rangeDelete(table): endpoint path does not resolve to a block node');
	return ensureUnsharedNode(node, sharing);
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
	// Same-path intra-table endpoints: cell-ness is context-established (same
	// path + table node), NOT flagged, so these read `.offset` directly — routing
	// them through cellIndexOf would warn spuriously. The cross-block cases below
	// carry the flag and do use the accessor.
	clearRectangularCells(table, start.offset, end.offset);
	rebuildUnsharedAncestry(doc, start.path, sharing);

	const meta = metadataOf(table, 'table');
	const cellsPerRow = meta.columnCount;
	const anchorRow = Math.floor(start.offset / cellsPerRow);
	const anchorCol = start.offset - anchorRow * cellsPerRow;

	return {
		newDoc: doc,
		collapsedCaret: { path: [...start.path, anchorRow, anchorCol], offset: 0 },
		tableRowSplices: []
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

interface EndWall {
	container: ChromeContainer;
	consumed: boolean;
}

/**
 * End-side wall context: the chrome container holding the end point, when the
 * range enters it from outside. `consumed` means the whole subtree is covered
 * — the chrome branch's last-byte rule for a prose end; for a table end, the
 * emptied table sitting on the container's last-child chain — so the container
 * unit-deletes instead of leaving a husk.
 */
function resolveEndWall(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endTableEmptied: boolean | null
): EndWall | null {
	const container = nearestChromeContainer(doc, end.path);
	if (!container || pathHasPrefix(start.path, container.path)) return null;
	const consumed =
		endTableEmptied === null
			? rangeConsumesContainer(container, end)
			: endTableEmptied && lastChildDescendant(container, end.path) !== null;
	return { container, consumed };
}

interface DeletionPlan {
	deletionPaths: number[][];
	chromeClearChain: CstNode[] | null;
}

/**
 * Covered subtree roots (chrome-ceremony parity: one splice per covered
 * subtree) plus endpoint paths the caller marks for removal, honoring the
 * chrome wall: a surviving end container's covered chrome CLEARS instead of
 * deleting (returned as an unshared chain for the caller's raw write +
 * rebuild), and a consumed container replaces its own endpoint/descendant
 * splices with one unit delete.
 */
function collectDeletionPlan(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endpointPaths: number[][],
	wall: EndWall | null,
	sharing: SharingState
): DeletionPlan {
	const between = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const chromeClearPath = wall && !wall.consumed ? [...wall.container.path, 0] : null;
	let chromeClearChain: CstNode[] | null = null;
	let candidates: number[][] = [];
	for (const p of between) {
		if (chromeClearPath && pathsEqual(p, chromeClearPath)) {
			const chain = ensureUnsharedPath(doc, p, sharing);
			if (chain.length === p.length) chromeClearChain = chain;
		} else {
			candidates.push(p);
		}
	}
	candidates.push(...endpointPaths);
	if (wall?.consumed) {
		candidates = candidates.filter((p) => !pathHasPrefix(p, wall.container.path));
		candidates.push(wall.container.path.slice());
	}
	return { deletionPaths: filterToSubtreeRoots(candidates), chromeClearChain };
}

/**
 * Plan the deletion — covered subtree roots plus caller-marked endpoint paths
 * (via {@link collectDeletionPlan}) — then own every deletion path's parent
 * spine before any splice (G1.9) and resolve the LCA cascade cleanup stops at.
 * The caller resolves `wall` itself: its `consumed` flag also gates each case's
 * endpoint prose-replace, which runs before this on some cases.
 */
function planCrossBlockDeletion(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endpointPaths: number[][],
	wall: EndWall | null,
	sharing: SharingState
): { plan: DeletionPlan; lcaPath: number[] } {
	const plan = collectDeletionPlan(doc, start, end, endpointPaths, wall, sharing);
	for (const path of plan.deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}
	return { plan, lcaPath: lowestCommonAncestor(start.path, end.path) };
}

/**
 * Apply the plan as one atomic step: clear a surviving end container's covered
 * chrome (raw write, never a node delete), then splice the covered subtrees in
 * reverse doc order under the identity gate. The cases sequence their endpoint
 * prose-replace before or after this call per their ordering comments.
 */
function applyPlannedDeletion(doc: Document, plan: DeletionPlan, lcaPath: number[]): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, lcaPath);
}

/**
 * Rebuild every deletion path's surviving ancestry, then the cleared chrome's
 * opener line (chain-based so the re-emit survives the splices). Shared tail of
 * every case's rebuild block; case-specific survivor rebuilds stay at the call
 * site, on their own side of this call.
 */
function rebuildSharedAncestries(doc: Document, plan: DeletionPlan, sharing: SharingState): void {
	for (const path of plan.deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing);
	}
	if (plan.chromeClearChain) rebuildUnsharedChain(plan.chromeClearChain, sharing);
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
	const startChar = charOffsetOf(start, 'deleteFromProseIntoTable:start');
	const startHead = startBlock.raw.slice(0, startChar);
	const startC = nearestChromeContainer(doc, start.path);
	const startIsChrome = startC !== null && isChromeChild(startC, start.path);
	let truncatedReplacement: CstNode[] | null = null;
	if (!startIsChrome) {
		truncatedReplacement = reparseWithFallback(startHead, startBlock.leadingTrivia);
		for (const node of truncatedReplacement) sharing.stamp(node);
	}

	// The snapped end cell is the whole-row inclusive last cell; deleteCellsAndCollapse
	// takes an exclusive end, so clearing the same rows the clipboard copied needs +1.
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
	if (startIsChrome) {
		// The wall: a chrome start truncates by raw write — kind and node kept.
		startBlock.raw = terminateLine(startHead, startBlock.raw);
	} else {
		replaceAtPath(doc, start.path, truncatedReplacement!);
	}

	const tableSurvives = result === 'tableSurvives';
	if (tableSurvives) rebuildOwnedContainer(table, sharing);
	rebuildUnsharedAncestry(doc, start.path, sharing);
	rebuildSharedAncestries(doc, plan, sharing);
	if (tableSurvives) rebuildUnsharedAncestry(doc, survivorPath(doc, table), sharing);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: startChar },
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
	sharing: SharingState
): RangeDeleteResult {
	const startCell = cellIndexOf(start, 'deleteFromTableIntoProse:start');
	const { result: tableResult, splice } = deleteCellsAndCollapse(
		table,
		startCell,
		totalCellCount(table)
	);

	const wall = resolveEndWall(doc, start, end, null);
	const consumed = wall?.consumed ?? false;
	const endIsChrome = wall !== null && !consumed && isChromeChild(wall.container, end.path);

	let tailReplacement: CstNode[] | null = null;
	let endTail = '';
	if (!consumed) {
		endTail = endBlock.raw.slice(charOffsetOf(end, 'deleteFromTableIntoProse:end'));
		if (!endIsChrome) {
			tailReplacement = reparseWithFallback(
				endTail || lineEndingOf(endBlock.raw),
				endBlock.leadingTrivia
			);
			for (const node of tailReplacement) sharing.stamp(node);
		}
	}

	const { plan, lcaPath } = planCrossBlockDeletion(
		doc,
		start,
		end,
		tableResult === 'tableEmpty' ? [start.path] : [],
		wall,
		sharing
	);

	// Replace/truncate end first: its path is later in doc order, so deleting
	// strictly-between doesn't shift it. Then delete strictly-between in
	// reverse, then optionally start.path. Skipped when the container dies whole.
	let tailNode: CstNode | null = null;
	if (endIsChrome) {
		// The wall: a chrome end keeps its tail by raw write — kind and node kept.
		endBlock.raw = endTail || lineEndingOf(endBlock.raw);
		tailNode = endBlock;
	} else if (!consumed) {
		replaceAtPath(doc, end.path, tailReplacement!);
		// Re-read through the tree (design rule 5): the raw replacement node is
		// proxy-wrapped by the live $state doc, so the identity search below
		// would miss the stored copy.
		tailNode = blockNodeAt(doc, end.path);
	}
	applyPlannedDeletion(doc, plan, lcaPath);

	const tailPath = tailNode ? survivorPath(doc, tailNode) : null;

	if (tableResult === 'tableSurvives') {
		rebuildOwnedContainer(table, sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing);
	}
	if (tailPath) rebuildUnsharedAncestry(doc, tailPath, sharing);
	rebuildSharedAncestries(doc, plan, sharing);

	// Case 2 of `e2e/requirements/blocks/table/cross-block-delete.md`: when the
	// table is fully consumed, the caret lands at the start of the surviving tail
	// — never the deleted table; otherwise in the table's surviving anchor cell.
	// With the tail consumed too, fall to the nearest survivor.
	const collapsedCaret: SelectionPoint =
		tableResult === 'tableEmpty'
			? tailPath
				? { path: tailPath, offset: 0 }
				: caretNearestSurvivor(doc, start.path, sharing)
			: survivingAnchorCellCaret(table, start.path, startCell);

	return {
		newDoc: doc,
		collapsedCaret,
		tableRowSplices: splice ? [{ table, ...splice }] : []
	};
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
		rebuildUnsharedAncestry(doc, start.path, sharing);
	}
	if (endTablePath) {
		rebuildOwnedContainer(endTable, sharing);
		rebuildUnsharedAncestry(doc, endTablePath, sharing);
	}
	rebuildSharedAncestries(doc, plan, sharing);

	let collapsedCaret: SelectionPoint;
	if (startResult === 'tableSurvives') {
		// Start table keeps its slot (deletions are all at or after start.path).
		collapsedCaret = survivingAnchorCellCaret(startTable, start.path, startCell);
	} else if (endTablePath) {
		// Start emptied → its block removed and the end table shifted. Land in
		// its first surviving cell (row 0, col 0).
		collapsedCaret = { path: [...endTablePath, 0, 0], offset: 0 };
	} else {
		collapsedCaret = caretNearestSurvivor(doc, start.path, sharing);
	}

	const tableRowSplices = [
		...(startSplice ? [{ table: startTable, ...startSplice }] : []),
		...(endSplice ? [{ table: endTable, ...endSplice }] : [])
	];
	return { newDoc: doc, collapsedCaret, tableRowSplices };
}

// Every block the caret could land in across the range was removed. Anchor-
// side convention: prefer the end of the nearest surviving block before the
// deleted range; else the start of the first surviving block after it; else
// materialize an empty paragraph (the document emptied — mirrors the prose
// rangeDelete fallback). Adjacent surviving tables get deep cell carets,
// never a shallow table path.
function caretNearestSurvivor(
	doc: Document,
	startPath: number[],
	sharing: SharingState
): SelectionPoint {
	const children = doc.children;
	const beforeIdx = startPath[0] - 1;

	if (beforeIdx >= 0) {
		const before = children[beforeIdx];
		if (before.kind === 'table') return lastCellCaret(before, [beforeIdx]);
		return survivorEndCaret(before, [beforeIdx]);
	}
	if (children.length > 0) {
		return children[0].kind === 'table' ? { path: [0, 0, 0], offset: 0 } : { path: [0], offset: 0 };
	}

	const filler: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
	sharing.stamp(filler);
	doc.children.push(filler);
	return { path: [0], offset: 0 };
}

// End-of-survivor caret, descending a container to the leaf that owns the
// bytes. A container (blockquote/list) survivor resolved to a char offset on
// its own path names bytes no leaf owns — the restore then clamps or mis-lands
// (focus of a non-zero container offset falls to the last child's end, losing
// the offset). The merge walk already knows the deepest focusable leaf; reuse
// it. A prose / self-merge leaf resolves to itself; a not-mergeable leaf
// (thematic break) keeps its own-end landing.
function survivorEndCaret(node: CstNode, path: number[]): SelectionPoint {
	const merge = findMergeTarget(node);
	if (merge) {
		return { path: [...path, ...merge.path], offset: displayLength(merge.target.raw) };
	}
	return { path, offset: displayLength(node.raw) };
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
 * Clear cells in `[startCellIdx, endCellIdx)`, remove rows where every cell
 * is in the range, and promote the next surviving row to header when row 0
 * goes. Mutates in place. Reports whether the table itself should be removed
 * (no rows remain) and the row window it spliced, so the commit can sync the
 * table's row state from the splice that actually happened.
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

	const startRow = Math.floor(startCellIdx / cellsPerRow);
	const startCol = startCellIdx - startRow * cellsPerRow;
	const lastRowInRange = Math.floor((endCellIdx - 1) / cellsPerRow);
	const lastColInRange = endCellIdx - 1 - lastRowInRange * cellsPerRow;

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
		metadataOf(rows[0], 'tableRow').isHeader = true;
	}
	return { result: 'tableSurvives', splice };
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
