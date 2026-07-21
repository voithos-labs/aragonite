/**
 * Cell-aware pointer drag and shift+click for tables. Builds the shallow-path
 * intra-table multi-cell SelectionState (anchor.path === focus.path === tablePath,
 * offsets are cellIdx-based) when input crosses cell boundaries inside one table.
 */

import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CellSelectionPoint, SelectionPoint } from '../../../selection/primitives';
import { offsetFromViewportPoint } from '../../../selection/native-bridge';
import { createPointerDragSession } from '../../../selection/pointer-session';
import { blockAtPoint } from '../../../selection/block-hit-test';
import { firstScrollableDescendant } from '../../../cursor/scroll-ancestors';

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
 * Install a pointer-drag listener for a drag that started inside `anchor`'s
 * cell. While the pointer stays in the same table, drives the SelectionState
 * shallow multi-cell encoding. When the pointer leaves the table entirely,
 * extends focus to the foreign block underneath the pointer (cross-block linear).
 *
 * Anchor cell coords are frozen; only the focus tracks the pointer.
 */
export function installCellDragListener(
	ctx: CellDragContext,
	anchor: CellAnchor,
	down: PointerEvent
): { dispose(): void } {
	const anchorCellIdx = anchor.rowIdx * anchor.columnCount + anchor.colIdx;
	// cellCoordinate marks the offset as a row-major cell index. When the drag
	// exits to a foreign block, the whole-row snap (table-endpoint-snap.ts) needs
	// it on this anchor so copy/delete agree on the same rows — without it a Cut
	// anchored mid-row row-rounds the copy while the delete clears from the
	// mid-cell, duplicating the leading cells. Same-table extends compare equal
	// paths and short-circuit the snap, so the intra-table rectangle is untouched.
	const anchorPoint: CellSelectionPoint = {
		path: anchor.tablePath.slice(),
		offset: anchorCellIdx,
		cellCoordinate: true
	};

	// `anchor.tableEl` is `[role="table"]`, the .block-host wrapper-equivalent
	// here. The actual scrollable element is its first scrollable descendant
	// (the .table-block grid).
	const tableScrollEl = firstScrollableDescendant(anchor.tableEl) ?? anchor.tableEl;

	function processMove(clientX: number, clientY: number): void {
		const cellHit = cellAtPoint(clientX, clientY, anchor.tableEl);

		if (cellHit) {
			if (cellHit.rowIdx === anchor.rowIdx && cellHit.colIdx === anchor.colIdx) {
				// Drag returned to anchor cell — collapse so native takes over
				// the intra-cell partial-text selection again.
				if (ctx.selection.isCrossBlock) {
					ctx.selection.collapse();
				}
				return;
			}
			extendToCell(cellHit.rowIdx, cellHit.colIdx);
			return;
		}

		// Pointer is not over a cell of this table. If still inside the table
		// element (e.g., padding gap between cells), hold the current focus —
		// avoids a flicker as the pointer crosses cell borders.
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
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;
		// A table destination addresses cells by row-major index, not char offset, and
		// must carry cellCoordinate so the whole-row snap fires symmetrically with the
		// anchor (matching the keyboard path, which flags both endpoints). Without it a
		// drag between two tables snaps only the anchor, mismapping the collapse caret
		// and slicing the destination grid markup.
		const offset = hit.foreignDragHitTest
			? hit.foreignDragHitTest(clientX, clientY)
			: offsetFromViewportPoint(hit.element, clientX, clientY);
		if (offset === null) return;
		const focusPoint: SelectionPoint = hit.foreignDragHitTest
			? ({ path: hit.path, offset, cellCoordinate: true } satisfies CellSelectionPoint)
			: { path: hit.path, offset };
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

/**
 * Shift+click on a cell when the previous focus was in another cell of the
 * same table. Builds the shallow-path multi-cell SelectionState directly.
 */
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
	// Flag the anchor as a row-major cell index, matching the drag anchor: an
	// exit-the-table extend later needs it so the whole-row snap fires. The focus
	// stays context-established (unflagged) — same-table extends short-circuit the
	// snap, so the intra-table rectangle is untouched.
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
// The cell grid's one selector contract: rows carry `data-table-row-idx`, cells
// carry `role="cell"`. Every table walker addresses the grid through these two
// helpers so a markup change lands in one place.

/**
 * The mounted table rows, in DOM order. Row windowing unmounts row 0 once the
 * table scrolls past it (VR-K1), so index 0 is the first MOUNTED row, not row 0;
 * uniform column tracks make any mounted row equivalent for column geometry.
 */
export function mountedRowEls(tableEl: HTMLElement): HTMLElement[] {
	return Array.from(tableEl.querySelectorAll<HTMLElement>(':scope > [data-table-row-idx]'));
}

/** The cells of one row, in column order. */
export function rowCellEls(rowEl: Element): HTMLElement[] {
	return Array.from(rowEl.querySelectorAll<HTMLElement>(':scope > [role="cell"]'));
}

// ── Hit testing ────────────────────────────────────────────────────────────

/**
 * Resolve a viewport point to a cell within `tableEl`. Returns null when the
 * point falls outside this specific table. Thin viewport-point entry over
 * `cellCoordsOfElement`, which owns the resolution and the owner-table check.
 */
export function cellAtPoint(
	clientX: number,
	clientY: number,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	return cellCoordsOfElement(document.elementFromPoint(clientX, clientY), tableEl);
}

/**
 * Resolve an arbitrary element (a click target, or the previously focused
 * `document.activeElement`) to its cell coords within `tableEl`. Returns null
 * when the element isn't inside a cell of this specific table — identity-checks
 * the owning table so a sibling table doesn't masquerade as the originating one.
 */
export function cellCoordsOfElement(
	el: Element | null,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	if (!el) return null;
	const cellEl = el.closest('[role="cell"]') as HTMLElement | null;
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
