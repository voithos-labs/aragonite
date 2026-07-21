/**
 * Pointer drag lifecycle for cross-block selection. Runs on a shared
 * `createPointerDragSession`, whose document-level listeners deliver events even
 * after the pointer leaves the originating block.
 */

import type { SelectionState } from './selection-state.svelte';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import type { BlockElLookup } from '../editor-keys';
import { offsetFromViewportPoint, applyCollapsedCaret } from './native-bridge';
import { comparePaths } from './path-math';
import { createPointerDragSession } from './pointer-session';
import { blockAtPoint } from './block-hit-test';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	scrollContainer: HTMLElement;
	selection: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Aborted on editor unmount; forwarded to the session's teardown. */
	lifetimeSignal?: AbortSignal;
}

// ── Public entry ───────────────────────────────────────────────────────────

/**
 * Install document-level pointer listeners for a cross-block drag started at
 * `down`. Returns a disposer for early teardown.
 */
export function installDragListener(
	ctx: DragContext,
	anchorPoint: SelectionPoint,
	down: PointerEvent
): { dispose(): void } {
	function processMove(clientX: number, clientY: number): void {
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;

		if (comparePaths(hit.path, anchorPoint.path) === 0) {
			if (ctx.selection.isCrossBlock) {
				// Pointer returned to the anchor block after cross-block was entered.
				// Collapse cross-block so the overlay stops painting the stale remote
				// range; the browser's drag has been extending native selection
				// underneath (CSS just hid it while data-cross-block was set), so
				// handing back to it produces the correct single-block highlight.
				ctx.selection.collapse();
			}
			return;
		}

		const isCellCoordinate = !!hit.foreignDragHitTest;
		const offset = isCellCoordinate
			? hit.foreignDragHitTest!(clientX, clientY)
			: offsetFromViewportPoint(hit.element, clientX, clientY);
		if (offset === null) return;

		// A table endpoint's offset is a row-major cell index, not a char offset.
		// The flag routes collapse/reveal to the deep cell (cellEndpointDeepPath)
		// and marks the point as the cell variant, matching the keyboard path.
		const focusPoint: SelectionPoint = isCellCoordinate
			? ({ path: hit.path, offset, cellCoordinate: true } satisfies CellSelectionPoint)
			: { path: hit.path, offset };
		if (!ctx.selection.isCrossBlock) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
	}

	// Pointer may land on a scrollable element directly (e.g., the table's
	// `.table-block` edge); search from `target` itself, not its parent.
	function scrollableSelfOrAncestor(target: HTMLElement): HTMLElement | null {
		let cur: HTMLElement | null = target;
		while (cur && cur !== ctx.editorRoot) {
			const cs = getComputedStyle(cur);
			const ox = cs.overflowX;
			const oy = cs.overflowY;
			if (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') return cur;
			cur = cur.parentElement;
		}
		return null;
	}

	return createPointerDragSession(down, {
		onMove: (p) => processMove(p.clientX, p.clientY),
		onEnd: () => {
			if (ctx.selection.isCrossBlock) parkCaretInFocusBlock(ctx);
		},
		autoScroll: {
			getTargets: (clientX, clientY) => {
				const targets: HTMLElement[] = [ctx.scrollContainer];
				const t = document.elementFromPoint(clientX, clientY);
				if (t instanceof HTMLElement) {
					const inner = scrollableSelfOrAncestor(t);
					if (inner && inner !== ctx.scrollContainer) targets.push(inner);
				}
				return targets;
			}
		},
		lifetimeSignal: ctx.lifetimeSignal
	});
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
