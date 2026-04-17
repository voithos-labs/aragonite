/**
 * Pointer drag lifecycle for cross-block selection. Installed on pointerdown
 * in a block component; removes itself on pointerup. Uses document-level
 * listeners so events are received even when the pointer leaves the
 * originating block.
 *
 * rAF is used for frame-paced continuous animation (drag throttle and
 * autoscroll), not for sequencing — see the editor design-rule note in
 * the v0.4 spec.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import { offsetFromViewportPoint, clearNativeSelection } from './native-bridge';
import { comparePaths } from './primitives';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	scrollContainer: HTMLElement;
	selection: SelectionState;
}

// ── Public entry ───────────────────────────────────────────────────────────

/**
 * Install pointermove + pointerup listeners on the document for the
 * duration of a drag. Call from a block's pointerdown after computing
 * the drag anchor point. Returns a disposer for early teardown.
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
			// Still in the anchor block — let the browser handle native selection.
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
		// Re-process the current pointer so selection follows the scroll.
		processMove(pendingMove.clientX, pendingMove.clientY);
	};

	function maybeAutoScroll(): void {
		if (autoScrollRafId !== null) return;
		if (!pendingMove) return;
		const rect = ctx.scrollContainer.getBoundingClientRect();
		const inThreshold = pendingMove.clientY < rect.top + threshold ||
			pendingMove.clientY > rect.bottom - threshold;
		if (!inThreshold) return;
		autoScrollRafId = requestAnimationFrame(step);
	}

	function onPointerUp(): void {
		dispose();
		if (ctx.selection.isCrossBlock) {
			clearNativeSelection();
		}
	}

	function dispose(): void {
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
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

	document.addEventListener('pointermove', onPointerMove);
	document.addEventListener('pointerup', onPointerUp);

	return { dispose };
}

// ── Hit test ───────────────────────────────────────────────────────────────

/**
 * Walk up from `elementFromPoint` to the nearest block ancestor inside
 * `editorRoot` carrying `data-block-path`. Returns the parsed path and
 * the contenteditable element to pass to `offsetFromViewportPoint`.
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
