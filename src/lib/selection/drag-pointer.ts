/**
 * Pointer drag lifecycle for cross-block selection. Runs on a shared
 * `createPointerDragSession`, whose document-level listeners deliver events even after the
 * pointer leaves the originating block.
 */

import type { UserScrollport } from '../cursor/scroll-ancestors';
import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { BlockElLookup } from '../editor-keys';
import { applyCollapsedCaret } from './native-bridge';
import { comparePaths } from './path-math';
import { createPointerDragSession } from './pointer-session';
import { endpointAtPoint } from './block-hit-test';
import { blockNearPoint } from './nearest-block';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DragContext {
	editorRoot: HTMLElement;
	/** What autoscrolls this drag: an element, or the window (`cursor/scroll-ancestors`). */
	scrollContainer: UserScrollport;
	selection: SelectionState;
	getBlockElByPath: BlockElLookup;
	/** Aborted on editor unmount; forwarded to the session's teardown. */
	lifetimeSignal?: AbortSignal;
}

// ── Public entry ───────────────────────────────────────────────────────────

/** Document-level pointer listeners for a cross-block drag started at `down`, plus a disposer. */
export function installDragListener(
	ctx: DragContext,
	anchorPoint: SelectionPoint,
	down: PointerEvent
): { dispose(): void } {
	function processMove(clientX: number, clientY: number): void {
		// The nearest block, not the one under the pointer: moves coalesce to one per frame, so a
		// burst ending in the margin would otherwise discard every on-block sample in it, and an
		// autoscrolling drag sends nothing but off-block points.
		const near = blockNearPoint(ctx.editorRoot, clientX, clientY);
		if (!near) return;
		const { hit, probeX, probeY } = near;

		if (comparePaths(hit.path, anchorPoint.path) === 0) {
			if (ctx.selection.isCrossBlock) {
				// Pointer returned to the anchor block: collapse so the overlay stops painting a
				// stale remote range. The browser's drag has been extending the native selection
				// underneath all along, so handing back gives the right single-block highlight.
				ctx.selection.collapse();
			}
			return;
		}

		const focusPoint = endpointAtPoint(hit, probeX, probeY);
		if (!focusPoint) return;
		if (!ctx.selection.isCrossBlock) {
			ctx.selection.enterCrossBlock(anchorPoint, focusPoint);
		} else {
			ctx.selection.extendFocus(focusPoint);
		}
	}

	// Pointer may land on a scrollable element directly (the table's `.table-block` edge), so
	// search from `target` itself, not its parent.
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
				const targets: UserScrollport[] = [ctx.scrollContainer];
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
 * Plant a collapsed native caret in the focus block as a paste/key-dispatch anchor; without it
 * Chromium routes paste events to <body>. The highlight still comes from SelectionOverlay.
 */
function parkCaretInFocusBlock(ctx: DragContext): void {
	const focus = ctx.selection.focus;
	if (!focus) return;
	// A drag ending inside a table leaves a focus addressing the table block by cell index; the
	// landing is the cell that actually holds a caret.
	const landing = ctx.selection.cellLandingFor(focus);
	const blockEl = ctx.getBlockElByPath(landing.path);
	if (!blockEl) return;
	applyCollapsedCaret(blockEl, landing);
}
