/**
 * Cell-aware pointer drag and shift+click for tables. Builds the shallow-path
 * intra-table multi-cell SelectionState (anchor.path === focus.path === tablePath,
 * offsets are cellIdx-based) when input crosses cell boundaries inside one table.
 */

import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { CellSelectionPoint, SelectionPoint } from '../../../selection/primitives';
import type { AnyBlockKind } from '../../../core/nodes';
import { offsetFromViewportPoint } from '../../../selection/native-bridge';
import { createAutoScroll } from '../../../selection/autoscroll';
import { firstScrollableDescendant } from '../../../cursor/scroll-ancestors';
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

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
	anchor: CellAnchor
): { dispose(): void } {
	let pendingMove: { clientX: number; clientY: number } | null = null;
	let rafId: number | null = null;

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

	const autoScroll = createAutoScroll({
		getPointer: () => pendingMove,
		getTargets: () => [tableScrollEl],
		onScrolled: () => {
			if (pendingMove) processMove(pendingMove.clientX, pendingMove.clientY);
		}
	});

	function onPointerMove(e: PointerEvent): void {
		pendingMove = { clientX: e.clientX, clientY: e.clientY };
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!pendingMove) return;
			processMove(pendingMove.clientX, pendingMove.clientY);
			autoScroll.maybeStart();
		});
	}

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

	function onPointerUp(): void {
		dispose();
	}

	function onPointerCancel(): void {
		dispose();
	}

	let disposed = false;
	function dispose(): void {
		if (disposed) return;
		disposed = true;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerCancel);
		if (ctx.lifetimeSignal) {
			ctx.lifetimeSignal.removeEventListener('abort', dispose);
		}
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		autoScroll.dispose();
		pendingMove = null;
	}

	if (ctx.lifetimeSignal) {
		if (ctx.lifetimeSignal.aborted) return { dispose };
		ctx.lifetimeSignal.addEventListener('abort', dispose, { once: true });
	}

	document.addEventListener('pointermove', onPointerMove);
	document.addEventListener('pointerup', onPointerUp);
	document.addEventListener('pointercancel', onPointerCancel);

	return { dispose };
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

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Mirrors drag-pointer.ts's `blockAtPoint` for the cross-block-linear handoff
 * case (drag exits the table). Walks up to the nearest data-block-path
 * ancestor — cells don't carry that attribute, so the search resolves to the
 * destination block (paragraph, header, etc.) rather than the originating cell.
 * A destination whose kind has internal coordinate addressing (another table)
 * carries its `foreignDragHitTest` so the focus can be a cell-coordinate point.
 */
function blockAtPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): {
	path: number[];
	element: HTMLElement;
	foreignDragHitTest?: (clientX: number, clientY: number) => number | null;
} | null {
	const target = document.elementFromPoint(clientX, clientY);
	if (!target) return null;

	let el: Element | null = target;
	while (el && el !== editorRoot) {
		if (el instanceof HTMLElement) {
			const attr = el.getAttribute('data-block-path');
			if (attr) {
				try {
					const path = JSON.parse(attr) as number[];
					const kind = el.getAttribute('data-block-kind');
					const hitTest = kind
						? tryGetBlockKindDescriptor(kind as AnyBlockKind)?.foreignDragHitTest
						: undefined;
					if (hitTest) {
						const wrapper = el;
						return {
							path,
							element: wrapper,
							foreignDragHitTest: (cx, cy) => hitTest(wrapper, cx, cy)
						};
					}
					const editable = el.querySelector('[contenteditable]') as HTMLElement | null;
					return { path, element: editable ?? el };
				} catch {
					return null;
				}
			}
		}
		el = el.parentElement;
	}
	return null;
}
