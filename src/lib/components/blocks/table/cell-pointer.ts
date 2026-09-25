/**
 * Pointer drag and Shift+click across a table's cells, and the cell hit tests they use. A
 * rectangle inside one table is a selection whose two endpoints both name the table's path,
 * with row-major cell indices as offsets.
 */

import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CellSelectionPoint, SelectionPoint } from '../../../selection/primitives';
import { createPointerDragSession } from '../../../selection/pointer-session';
import { blockNearPoint } from '../../../selection/nearest-block';
import { firstScrollableDescendant } from '../../../cursor/scroll-ancestors';
import { TABLE_CELL_SELECTOR } from '../../block-content-selector';

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

/**
 * Pointer-drag from inside `anchor`'s cell: drives the multi-cell encoding while the
 * pointer stays in the table, and extends focus to the foreign block underneath once
 * it leaves. Anchor cell coords are frozen; only the focus tracks the pointer.
 */
export function installCellDragListener(
	ctx: CellDragContext,
	anchor: CellAnchor,
	down: PointerEvent
): { dispose(): void } {
	const anchorCellIdx = anchor.rowIdx * anchor.columnCount + anchor.colIdx;
	// Flagged as a cell index, so a drag that leaves the table snaps to whole rows
	// (table-endpoint-snap.ts) and copy and delete agree on which rows it covers.
	const anchorPoint: CellSelectionPoint = {
		path: anchor.tablePath.slice(),
		offset: anchorCellIdx,
		cellCoordinate: true
	};

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

	function extendToCell(rowIdx: number, colIdx: number): void {
		const cellIdx = rowIdx * anchor.columnCount + colIdx;
		const focusPoint: SelectionPoint = {
			path: anchor.tablePath.slice(),
			offset: cellIdx
		};
		if (!ctx.selection.isCustomRendered) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
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
		if (!ctx.selection.isCustomRendered) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
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
	const anchorCellIdx = anchor.rowIdx * anchor.columnCount + anchor.colIdx;
	const focusCellIdx = target.rowIdx * anchor.columnCount + target.colIdx;
	const tablePath = anchor.tablePath.slice();

	if (selection.isCustomRendered) {
		selection.extendFocus({ path: tablePath, offset: focusCellIdx });
		return;
	}
	// Flagged row-major to match the drag anchor, so a later exit-the-table extend snaps
	// whole rows. The focus stays unflagged: same-table extends short-circuit the snap.
	selection.enterCrossBlock(
		{
			path: tablePath.slice(),
			offset: anchorCellIdx,
			cellCoordinate: true
		} satisfies CellSelectionPoint,
		{ path: tablePath.slice(), offset: focusCellIdx }
	);
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
