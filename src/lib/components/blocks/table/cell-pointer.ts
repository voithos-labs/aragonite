/**
 * Cell-aware pointer drag and shift+click for tables. Builds the shallow-path
 * intra-table multi-cell SelectionState (anchor.path === focus.path === tablePath,
 * offsets are cellIdx-based) when input crosses cell boundaries inside one table.
 *
 * Spec: docs/superpowers/specs/2026-04-26-table-block-design.md § Selection.
 */

import type { SelectionState } from '../../../selection/selection-state.svelte';
import type { SelectionPoint } from '../../../selection/primitives';
import { offsetFromViewportPoint } from '../../../selection/native-bridge';
import { createAutoScroll } from '../../../selection/autoscroll';
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
	anchor: CellAnchor
): { dispose(): void } {
	let pendingMove: { clientX: number; clientY: number } | null = null;
	let rafId: number | null = null;

	const anchorCellIdx = anchor.rowIdx * anchor.columnCount + anchor.colIdx;
	const anchorPoint: SelectionPoint = {
		path: anchor.tablePath.slice(),
		offset: anchorCellIdx
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
		const offset = offsetFromViewportPoint(hit.element, clientX, clientY);
		if (offset === null) return;
		const focusPoint: SelectionPoint = { path: hit.path, offset };
		// Anchor stays cell-encoded (shallow tablePath, cellIdx offset); foreign focus carries a deep block path with a character offset. Consumers disambiguate via pathsEqual / isCustomRendered.
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
	selection.enterCrossBlock(
		{ path: tablePath.slice(), offset: anchorCellIdx },
		{ path: tablePath.slice(), offset: focusCellIdx }
	);
}

// ── Hit testing ────────────────────────────────────────────────────────────

/**
 * Resolve a viewport point to a cell within `tableEl`. Returns null when the
 * point falls outside this specific table — identity-checks the owning table
 * so a sibling table doesn't masquerade as the originating one.
 */
export function cellAtPoint(
	clientX: number,
	clientY: number,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number; cellEl: HTMLElement } | null {
	const target = document.elementFromPoint(clientX, clientY);
	if (!target) return null;
	const cellEl = (target as Element).closest('[role="cell"]') as HTMLElement | null;
	if (!cellEl) return null;
	const rowEl = cellEl.closest('[data-table-row-idx]') as HTMLElement | null;
	if (!rowEl) return null;
	const ownerTable = rowEl.closest('[role="table"]') as HTMLElement | null;
	if (ownerTable !== tableEl) return null;

	const rowIdxAttr = rowEl.getAttribute('data-table-row-idx');
	if (rowIdxAttr === null) return null;
	const rowIdx = Number(rowIdxAttr);
	if (Number.isNaN(rowIdx)) return null;

	const cellsInRow = Array.from(rowEl.querySelectorAll(':scope > [role="cell"]'));
	const colIdx = cellsInRow.indexOf(cellEl);
	if (colIdx < 0) return null;

	return { rowIdx, colIdx, cellEl };
}

/**
 * Find the cell coords of an arbitrary element (e.g., the previously focused
 * `document.activeElement`). Returns null when the element isn't inside a
 * cell of `tableEl`.
 */
export function cellCoordsOfElement(
	el: Element | null,
	tableEl: HTMLElement
): { rowIdx: number; colIdx: number } | null {
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

	const cellsInRow = Array.from(rowEl.querySelectorAll(':scope > [role="cell"]'));
	const colIdx = cellsInRow.indexOf(cellEl);
	if (colIdx < 0) return null;

	return { rowIdx, colIdx };
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Mirrors drag-pointer.ts's `blockAtPoint` for the cross-block-linear handoff
 * case (drag exits the table). Walks up to the nearest data-block-path
 * ancestor — cells don't carry that attribute, so the search resolves to the
 * destination block (paragraph, header, etc.) rather than the originating cell.
 */
function blockAtPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): { path: number[]; element: HTMLElement } | null {
	const target = document.elementFromPoint(clientX, clientY);
	if (!target) return null;

	let el: Element | null = target;
	while (el && el !== editorRoot) {
		if (el instanceof HTMLElement) {
			const attr = el.getAttribute('data-block-path');
			if (attr) {
				try {
					const path = JSON.parse(attr) as number[];
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
