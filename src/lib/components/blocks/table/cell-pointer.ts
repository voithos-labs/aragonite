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
	// cellCoordinate marks the offset row-major, so a drag that exits to a foreign block
	// gets the whole-row snap (table-endpoint-snap.ts) and copy/delete agree on the same
	// rows. Same-table extends compare equal paths and short-circuit the snap.
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
				// Back in the anchor cell: collapse so native resumes the intra-cell selection.
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
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;
		// A table destination addresses cells by row-major index, so it must carry
		// cellCoordinate for the whole-row snap to fire symmetrically with the anchor.
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
// Selector contract: rows carry `data-table-row-idx`, cells carry `role="cell"`. Two
// other readers walk the same selectors — `selection/path-lookup.ts` upward and
// `Editor.svelte`'s `getBlockElByPath` downward — so a markup change lands in all three.

/**
 * The mounted table rows, in DOM order. Row windowing unmounts row 0 once the table
 * scrolls past it (VR-K1), so index 0 is the first MOUNTED row — still fine for column
 * geometry, since the column tracks are uniform.
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
 * A viewport point → its cell within `tableEl`, or null when the point falls outside
 * this specific table. Thin entry over `cellCoordsOfElement`.
 */
export function cellAtPoint(
	clientX: number,
	clientY: number,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	return cellCoordsOfElement(document.elementFromPoint(clientX, clientY), tableEl);
}

/**
 * An element (click target, previously focused element) → its cell coords within
 * `tableEl`. Identity-checks the owning table, so a sibling table can't masquerade
 * as the originating one.
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
