/**
 * Pointer drag lifecycle for cross-block selection. Uses document-level
 * listeners so events arrive even after the pointer leaves the originating
 * block. rAF is used for frame-paced continuous animation, not sequencing.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { BlockElLookup } from '../contracts';
import { offsetFromViewportPoint, applyCollapsedCaret } from './native-bridge';
import { comparePaths } from './primitives';
import { cellAtPoint } from '../components/blocks/table/cell-pointer';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	scrollContainer: HTMLElement;
	selection: SelectionState;
	getBlockElByPath: BlockElLookup;
	/**
	 * Aborted on editor unmount. Without this, an unmount mid-drag would
	 * leak the document-level pointermove/pointerup listeners (pointerup
	 * never fires because the originating element is gone).
	 */
	lifetimeSignal?: AbortSignal;
}

// ── Public entry ───────────────────────────────────────────────────────────

/**
 * Install document-level pointermove + pointerup listeners for a drag.
 * Returns a disposer for early teardown.
 */
export function installDragListener(
	ctx: DragContext,
	anchorPoint: SelectionPoint
): { dispose(): void } {
	let autoScrollRafId: number | null = null;
	let pendingMove: { clientX: number; clientY: number } | null = null;
	let rafId: number | null = null;

	function onPointerMove(e: PointerEvent): void {
		pendingMove = { clientX: e.clientX, clientY: e.clientY };
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!pendingMove) return;
			processMove(pendingMove.clientX, pendingMove.clientY);
			maybeAutoScroll();
		});
	}

	function processMove(clientX: number, clientY: number): void {
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;

		if (comparePaths(hit.path, anchorPoint.path) === 0) {
			// Still in anchor block — let the browser handle native selection.
			return;
		}

		const offset = hit.isTable
			? tableCellOffsetAt(hit.element, clientX, clientY)
			: offsetFromViewportPoint(hit.element, clientX, clientY);
		if (offset === null) return;

		const focusPoint: SelectionPoint = { path: hit.path, offset };
		if (!ctx.selection.isCrossBlock) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
	}

	const threshold = 30;

	const step = () => {
		if (!pendingMove) {
			autoScrollRafId = null;
			return;
		}
		const rect = ctx.scrollContainer.getBoundingClientRect();
		let d = 0;
		if (pendingMove.clientY < rect.top + threshold) {
			d = -((rect.top + threshold - pendingMove.clientY) / 2);
		} else if (pendingMove.clientY > rect.bottom - threshold) {
			d = (pendingMove.clientY - (rect.bottom - threshold)) / 2;
		}
		if (d === 0) {
			autoScrollRafId = null;
			return;
		}
		ctx.scrollContainer.scrollTop += d;
		autoScrollRafId = requestAnimationFrame(step);
		// Re-process so selection follows the scroll.
		processMove(pendingMove.clientX, pendingMove.clientY);
	};

	function maybeAutoScroll(): void {
		if (autoScrollRafId !== null) return;
		if (!pendingMove) return;
		const rect = ctx.scrollContainer.getBoundingClientRect();
		const inThreshold =
			pendingMove.clientY < rect.top + threshold || pendingMove.clientY > rect.bottom - threshold;
		if (!inThreshold) return;
		autoScrollRafId = requestAnimationFrame(step);
	}

	function onPointerUp(): void {
		dispose();
		if (ctx.selection.isCrossBlock) {
			parkCaretInFocusBlock(ctx);
		}
	}

	// Touch/stylus and Tauri WebView2 surface gestures fire pointercancel
	// instead of pointerup when the OS reclaims the pointer; without this
	// listener pointermove + raf would leak until editor unmount.
	function onPointerCancel(): void {
		dispose();
		if (ctx.selection.isCrossBlock) {
			parkCaretInFocusBlock(ctx);
		}
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
		if (autoScrollRafId !== null) {
			cancelAnimationFrame(autoScrollRafId);
			autoScrollRafId = null;
		}
		pendingMove = null;
	}

	if (ctx.lifetimeSignal) {
		if (ctx.lifetimeSignal.aborted) {
			return { dispose };
		}
		ctx.lifetimeSignal.addEventListener('abort', dispose, { once: true });
	}

	document.addEventListener('pointermove', onPointerMove);
	document.addEventListener('pointerup', onPointerUp);
	document.addEventListener('pointercancel', onPointerCancel);

	return { dispose };
}

/**
 * Plant a collapsed native caret in the focus block as a paste/key-dispatch
 * anchor. Without it, Chromium routes paste events to <body>. The visual
 * cross-block highlight still comes from SelectionOverlay.
 */
function parkCaretInFocusBlock(ctx: DragContext): void {
	if (!ctx.selection.focus) return;
	const blockEl = ctx.getBlockElByPath(ctx.selection.focus.path);
	if (!blockEl) return;
	applyCollapsedCaret(blockEl, ctx.selection.focus);
}

// ── Hit test ───────────────────────────────────────────────────────────────

interface BlockHit {
	path: number[];
	element: HTMLElement;
	/**
	 * Tables encode focus offsets as cellIdx, not character offset
	 * (range-delete-table reads offset as `row * columnCount + col`). When set,
	 * `element` points to the [role="table"] element so cellAtPoint can resolve
	 * row/column from the same node tree.
	 */
	isTable?: boolean;
}

function blockAtPoint(
	editorRoot: HTMLElement,
	clientX: number,
	clientY: number
): BlockHit | null {
	const target = document.elementFromPoint(clientX, clientY);
	if (!target) return null;

	let el: Element | null = target;
	while (el && el !== editorRoot) {
		if (el instanceof HTMLElement) {
			const attr = el.getAttribute('data-block-path');
			if (attr) {
				try {
					const path = JSON.parse(attr) as number[];
					const tableEl = el.querySelector(':scope > [role="table"]') as HTMLElement | null;
					if (tableEl) {
						return { path, element: tableEl, isTable: true };
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

/**
 * Resolve a viewport point inside a table to a cellIdx offset. Returns null
 * when the point falls in cell padding/borders so the caller can hold the
 * previous focus instead of flickering.
 */
function tableCellOffsetAt(tableEl: HTMLElement, clientX: number, clientY: number): number | null {
	const cell = cellAtPoint(clientX, clientY, tableEl);
	if (!cell) return null;
	const firstRow = tableEl.querySelector(':scope > [data-table-row-idx="0"]');
	if (!firstRow) return null;
	const columnCount = firstRow.querySelectorAll(':scope > [role="cell"]').length;
	if (columnCount === 0) return null;
	return cell.rowIdx * columnCount + cell.colIdx;
}
