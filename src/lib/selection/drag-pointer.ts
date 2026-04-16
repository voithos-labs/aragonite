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
import type { SelectionPoint } from './selection-types';
import { offsetFromViewportPoint, clearNativeSelection } from './native-bridge';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	scrollContainer: HTMLElement;
	selection: SelectionState;
	getBlockElByPath(path: number[]): HTMLElement | null;
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
			maybeAutoScroll(pendingMove.clientY);
		});
	}

	function processMove(clientX: number, clientY: number): void {
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;

		if (pathsEqual(hit.path, anchorPoint.path)) {
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

	function maybeAutoScroll(clientY: number): void {
		const rect = ctx.scrollContainer.getBoundingClientRect();
		const threshold = 30;
		let delta = 0;

		if (clientY < rect.top + threshold) {
			delta = -((rect.top + threshold - clientY) / 2);
		} else if (clientY > rect.bottom - threshold) {
			delta = (clientY - (rect.bottom - threshold)) / 2;
		}

		if (delta === 0) {
			if (autoScrollRafId !== null) {
				cancelAnimationFrame(autoScrollRafId);
				autoScrollRafId = null;
			}
			return;
		}

		// Already scrolling — let the existing loop update the delta next frame.
		if (autoScrollRafId !== null) return;

		const step = () => {
			ctx.scrollContainer.scrollTop += delta;
			autoScrollRafId = requestAnimationFrame(step);
			// Re-process the same pointer coordinate so selection follows the scroll.
			if (pendingMove) processMove(pendingMove.clientX, pendingMove.clientY);
		};
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

function pathsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
