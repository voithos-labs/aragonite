/**
 * Pointer drag and Shift+click across a table's cells, and the cell hit tests they use. A
 * rectangle inside one table is a selection whose two endpoints both name the table's path,
 * with flagged row-major cell indices as offsets.
 */

import type { SelectionState } from '../../../selection/selection-state.svelte';
import {
	cellPoint,
	type CellSelectionPoint,
	type SelectionEndpoint
} from '../../../selection/primitives';
import { rowMajorCellIndex } from '../../../cursor/coordinate-spaces';
import { createPointerDragSession } from '../../../selection/pointer-session';
import { blockNearPoint } from '../../../selection/nearest-block';
import { firstScrollableDescendant } from '../../../cursor/scroll-ancestors';
import { TABLE_CELL_SELECTOR } from '../../block-content-selector';
import { caretOffsetAtPoint } from '../../../cursor/point-offset';
import { applySingleBlockRange } from '../../../selection/native-bridge';
import type { PaddingPress } from '../../../selection/cross-block/pointer';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CellAnchor {
	tableEl: HTMLElement;
	tablePath: number[];
	rowIdx: number;
	colIdx: number;
	columnCount: number;
}

export interface CellDragContext {
	editorRoot: HTMLElement;
	selection: SelectionState;
	lifetimeSignal?: AbortSignal;
}

// ── Public API ─────────────────────────────────────────────────────────────

/** A press in the anchor cell's padding that the editor placed, so no native drag selects in the
 *  cell and the session paints the range there itself. */
export interface CellPaddingPress {
	surface: HTMLElement;
	press: PaddingPress;
}

/** A drag from inside `anchor`'s cell selects a cell rectangle while the pointer stays in the
 *  table and extends to the block underneath once it leaves; the anchor cell stays fixed. */
export function installCellDragListener(
	ctx: CellDragContext,
	anchor: CellAnchor,
	down: PointerEvent,
	padding: CellPaddingPress | null = null
): { dispose(): void } {
	// Flagged as a cell index, so a drag that leaves the table snaps to whole rows
	// (table-endpoint-snap.ts) and copy and delete agree on which rows it covers.
	const anchorPoint = anchorCellPoint(anchor);

	// `anchor.tableEl` is `[role="table"]`; the scrollable element is its first
	// scrollable descendant (the `.table-block` grid).
	const tableScrollEl = firstScrollableDescendant(anchor.tableEl) ?? anchor.tableEl;

	function processMove(clientX: number, clientY: number): void {
		const cellHit = cellAtPoint(clientX, clientY, anchor.tableEl);

		if (cellHit) {
			if (cellHit.rowIdx === anchor.rowIdx && cellHit.colIdx === anchor.colIdx) {
				// Back in the anchor cell: collapse so the browser resumes selecting inside it.
				if (ctx.selection.isCrossBlock) {
					ctx.selection.collapse();
				}
				paintInAnchorCell(clientX, clientY);
				return;
			}
			extendToCell(cellHit.rowIdx, cellHit.colIdx);
			return;
		}

		// Inside the table but not over a cell (a padding gap): hold the current focus,
		// so crossing a cell border doesn't flicker.
		const target = document.elementFromPoint(clientX, clientY);
		if (target && anchor.tableEl.contains(target)) return;

		extendToForeignBlock(clientX, clientY);
	}

	function paintInAnchorCell(clientX: number, clientY: number): void {
		if (!padding?.press.placed()) return;
		const focus = caretOffsetAtPoint(padding.surface, clientX, clientY);
		if (focus !== null) applySingleBlockRange(padding.surface, padding.press.offset, focus);
	}

	function extendToCell(rowIdx: number, colIdx: number): void {
		const focus = cellPoint(
			anchor.tablePath,
			rowMajorCellIndex(rowIdx, colIdx, anchor.columnCount)
		);
		enterOrExtend(ctx.selection, anchorPoint, focus);
	}

	function extendToForeignBlock(clientX: number, clientY: number): void {
		// Nearest, not under: one coalesced frame can hand over a point off every block (the
		// margin, a gutter), and declining it would drop the whole gesture.
		const near = blockNearPoint(ctx.editorRoot, clientX, clientY);
		if (!near) return;
		// Shared with the cross-block drag, so a table destination carries cellCoordinate for the
		// whole-row snap just as the anchor does, and a kind with no editable element is skipped.
		const focusPoint = near.endpointHere();
		if (!focusPoint) return;
		enterOrExtend(ctx.selection, anchorPoint, focusPoint);
	}

	return createPointerDragSession(down, {
		onMove: (p) => processMove(p.clientX, p.clientY),
		autoScroll: { getTargets: () => [tableScrollEl] },
		lifetimeSignal: ctx.lifetimeSignal
	});
}

/** Shift+click on a cell when the previous focus was another cell of the same table. */
export function handleCellShiftClick(
	selection: SelectionState,
	anchor: CellAnchor,
	target: { rowIdx: number; colIdx: number }
): void {
	const focus = cellPoint(
		anchor.tablePath,
		rowMajorCellIndex(target.rowIdx, target.colIdx, anchor.columnCount)
	);
	enterOrExtend(selection, anchorCellPoint(anchor), focus);
}

// ── Shared ─────────────────────────────────────────────────────────────────

function anchorCellPoint(anchor: CellAnchor): CellSelectionPoint {
	return cellPoint(
		anchor.tablePath,
		rowMajorCellIndex(anchor.rowIdx, anchor.colIdx, anchor.columnCount)
	);
}

/** The first move past the anchor starts the range; later ones only move its focus. */
function enterOrExtend(
	selection: SelectionState,
	anchor: CellSelectionPoint,
	focus: SelectionEndpoint
): void {
	if (selection.isCustomRendered) selection.extendFocus(focus);
	else selection.enterCrossBlock(anchor, focus);
}

// ── DOM geometry ─────────────────────────────────────────────────────────────
//
// Rows carry `data-table-row-idx` and cells match `TABLE_CELL_SELECTOR`; `selection/path-lookup.ts`
// and `components/block-el-lookup.ts` read the same markup, so a change to it reaches all three.

/** The mounted rows in DOM order; under row windowing the first need not be row 0, which
 *  column geometry can ignore because every row shares the column tracks. */
export function mountedRowEls(tableEl: HTMLElement): HTMLElement[] {
	return Array.from(tableEl.querySelectorAll<HTMLElement>(':scope > [data-table-row-idx]'));
}

/** The cells of one row, in column order. */
export function rowCellEls(rowEl: Element): HTMLElement[] {
	return Array.from(rowEl.querySelectorAll<HTMLElement>(`:scope > ${TABLE_CELL_SELECTOR}`));
}

// ── Hit testing ────────────────────────────────────────────────────────────

/** The cell of `tableEl` under a viewport point, or null outside this table. */
export function cellAtPoint(
	clientX: number,
	clientY: number,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	return cellCoordsOfElement(document.elementFromPoint(clientX, clientY), tableEl);
}

/** The cell of `tableEl` an element sits in; the owning table is compared by identity, so a
 *  cell of a nested or sibling table never answers for this one. */
export function cellCoordsOfElement(
	el: Element | null,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	if (!el) return null;
	const cellEl = el.closest(TABLE_CELL_SELECTOR) as HTMLElement | null;
	if (!cellEl) return null;
	const rowEl = cellEl.closest('[data-table-row-idx]') as HTMLElement | null;
	if (!rowEl) return null;
	if (rowEl.closest('[role="table"]') !== tableEl) return null;

	const rowIdxAttr = rowEl.getAttribute('data-table-row-idx');
	if (rowIdxAttr === null) return null;
	const rowIdx = Number(rowIdxAttr);
	if (Number.isNaN(rowIdx)) return null;

	const colIdx = rowCellEls(rowEl).indexOf(cellEl);
	if (colIdx < 0) return null;

	return { rowIdx, colIdx, cellEl };
}
