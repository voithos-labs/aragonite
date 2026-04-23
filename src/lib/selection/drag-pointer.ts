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

		const offset = offsetFromViewportPoint(hit.element, clientX, clientY);
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
