/**
 * Pointer half of the cross-block dispatcher: shift-click extension and pointer-drag entry. See
 * dispatch.ts for the composer that wires this together with the keydown half.
 */

import type { CrossBlockDispatchContext } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import type { StickyColumnState } from '../../cursor/sticky-column';
import { handleShiftClick } from '../keyboard-extend';
import { findBlockPathForElement } from '../path-lookup';
import { clearNativeSelection, offsetFromViewportPoint } from '../native-bridge';
import { installDragListener } from '../drag-pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockPointer {
	handlePointerDown(e: PointerEvent): boolean;
}

export function createCrossBlockPointer(ctx: CrossBlockDispatchContext): CrossBlockPointer {
	return {
		handlePointerDown: (e) => handlePointerDown(ctx, e)
	};
}

/**
 * Shared pointerdown preamble for any block that intercepts cross-block input. Resets
 * sticky-column and the select-all counter, and on a non-shift press clears any active
 * cross-block selection so a fresh drag doesn't extend the prior range.
 */
export function resetForPointerDown(
	selection: SelectionState,
	stickyColumn: StickyColumnState,
	isShift: boolean
): void {
	stickyColumn.reset();
	selection.resetSelectAllCount();
	if (!isShift && selection.isCrossBlock) {
		selection.clear();
		clearNativeSelection();
	}
}

// ── Pointer ────────────────────────────────────────────────────────────────

function handlePointerDown(ctx: CrossBlockDispatchContext, e: PointerEvent): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection } = ctx;
	const myPath = ctx.getMyPath();

	resetForPointerDown(selection, ctx.stickyColumn, e.shiftKey);

	if (e.shiftKey) {
		const prevActive = document.activeElement;
		const prevFocusEl =
			prevActive instanceof HTMLElement && prevActive !== el
				? (prevActive.closest('[contenteditable]') as HTMLElement | null)
				: null;
		const prevFocusPath = findBlockPathForElement(prevActive);
		const handled = handleShiftClick(
			selection,
			el,
			myPath,
			e.clientX,
			e.clientY,
			prevFocusEl,
			prevFocusPath
		);
		if (handled) {
			e.preventDefault();
			return true;
		}
	}

	if (!e.shiftKey) {
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
		if (offset === null) return false;
		// SelectionState normalizes table endpoints on cross-block entry, so the raw block path
		// is a valid anchor here.
		const anchorPoint = { path: myPath.slice(), offset };
		const lifetimeSignal = ctx.getEditorLifetime();
		if (!lifetimeSignal) {
			if (import.meta.env.DEV) {
				console.warn(
					'[cross-block-dispatch] editor lifetime signal unavailable; skipping drag install to avoid document-listener leak on unmount'
				);
			}
			return false;
		}
		installDragListener(
			{
				editorRoot: root,
				// The root is the hit-test boundary; what SCROLLS may be an ancestor in
				// host-scroll mode, so the two resolve separately.
				scrollContainer: ctx.getScrollHost() ?? root,
				selection,
				getBlockElByPath: ctx.getBlockElByPath,
				lifetimeSignal
			},
			anchorPoint,
			e
		);
	}

	return false;
}
