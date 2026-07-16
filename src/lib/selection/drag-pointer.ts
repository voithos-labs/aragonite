/**
 * Pointer drag lifecycle for cross-block selection. Uses document-level
 * listeners so events arrive even after the pointer leaves the originating
 * block. rAF is used for frame-paced continuous animation, not sequencing.
 */

import type { SelectionState } from './selection-state.svelte';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import type { BlockElLookup } from '../editor-keys';
import type { AnyBlockKind } from '../core/nodes';
import { offsetFromViewportPoint, applyCollapsedCaret } from './native-bridge';
import { comparePaths } from './path-math';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { createAutoScroll } from './autoscroll';

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
	let pendingMove: { clientX: number; clientY: number } | null = null;
	let rafId: number | null = null;

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
		const hit = blockAtPoint(ctx.editorRoot, clientX, clientY);
		if (!hit) return;

		if (comparePaths(hit.path, anchorPoint.path) === 0) {
			if (ctx.selection.isCrossBlock) {
				// Pointer returned to the anchor block after cross-block was
				// entered. Collapse cross-block so the overlay stops painting
				// the stale remote range; the browser's drag has been extending
				// native selection underneath (CSS just hid it while
				// data-cross-block was set), so handing back to it produces
				// the correct single-block highlight.
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

	const autoScroll = createAutoScroll({
		getPointer: () => pendingMove,
		getTargets: (clientX, clientY) => {
			const targets: HTMLElement[] = [ctx.scrollContainer];
			const t = document.elementFromPoint(clientX, clientY);
			if (t instanceof HTMLElement) {
				const inner = scrollableSelfOrAncestor(t);
				if (inner && inner !== ctx.scrollContainer) targets.push(inner);
			}
			return targets;
		},
		onScrolled: () => {
			if (pendingMove) processMove(pendingMove.clientX, pendingMove.clientY);
		}
	});

	function flushPendingMove(): void {
		// A release landing before the coalescing rAF runs would otherwise drop
		// the final move, leaving isCrossBlock false on a fast flick or a
		// pointercancel (touch / Tauri WebView2).
		if (rafId !== null && pendingMove) {
			processMove(pendingMove.clientX, pendingMove.clientY);
		}
	}

	function onPointerUp(): void {
		flushPendingMove();
		dispose();
		if (ctx.selection.isCrossBlock) {
			parkCaretInFocusBlock(ctx);
		}
	}

	// Touch/stylus and Tauri WebView2 surface gestures fire pointercancel
	// instead of pointerup when the OS reclaims the pointer; without this
	// listener pointermove + raf would leak until editor unmount.
	function onPointerCancel(): void {
		flushPendingMove();
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
		autoScroll.dispose();
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
	/** Editable surface for character-offset hit-testing (or the wrapper when none). */
	element: HTMLElement;
	/**
	 * Set for block kinds with internal coordinate addressing (e.g. table,
	 * whose offset is a row-major cellIdx, not a character index). Pre-bound to
	 * the block's wrapper element; resolved from the kind's descriptor so the
	 * selection layer carries no block-specific DOM knowledge.
	 */
	foreignDragHitTest?: (clientX: number, clientY: number) => number | null;
}

function blockAtPoint(editorRoot: HTMLElement, clientX: number, clientY: number): BlockHit | null {
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
					// tryGet tolerates junk DOM strings — unregistered kinds resolve undefined.
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
