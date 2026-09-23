/**
 * Pointer half of the cross-block dispatcher: shift-click extension and pointer-drag entry. See
 * dispatch.ts for the composer that wires this together with the keydown half.
 */

import type { CrossBlockDispatchContext, PointerPressOptions } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import type { StickyColumnState } from '../../cursor/sticky-column';
import type { EdgeAffinityState } from '../../cursor/edge-affinity';
import { handleShiftClick } from '../keyboard-extend';
import { findBlockPathForElement } from '../path-lookup';
import { clearNativeSelection } from '../native-bridge';
import { offsetFromViewportPoint } from '../../cursor/point-offset';
import { installDragListener } from '../drag-pointer';
import { devWarn } from '../../dev-warn';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockPointer {
	handlePointerDown(e: PointerEvent, press?: PointerPressOptions): boolean;
}

export function createCrossBlockPointer(ctx: CrossBlockDispatchContext): CrossBlockPointer {
	return {
		handlePointerDown: (e, press) => handlePointerDown(ctx, e, press)
	};
}

/**
 * The shared pointerdown reset for any block that handles cross-block input. Resets the sticky
 * column and the select-all counter, and on a plain click clears any active cross-block
 * selection so a fresh drag does not extend the prior range. The pointer counterpart of
 * `caret-doors.ts`, so it ends the gap caret too.
 */
export function resetForPointerDown(
	selection: SelectionState,
	stickyColumn: StickyColumnState,
	edgeAffinity: EdgeAffinityState,
	isShift: boolean
): void {
	stickyColumn.reset();
	edgeAffinity.reset();
	selection.resetSelectAllCount();
	// Unconditional, unlike the range branch: a gap caret is always collapsed, so a shift-click
	// has no range to grow from it. Silent when no gap caret is live.
	selection.clearGapCaret();
	if (!isShift && selection.isCrossBlock) {
		selection.clear();
		clearNativeSelection();
	}
}

// ── Pointer ────────────────────────────────────────────────────────────────

function handlePointerDown(
	ctx: CrossBlockDispatchContext,
	e: PointerEvent,
	press: PointerPressOptions = {}
): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection } = ctx;
	const myPath = ctx.getMyPath();

	resetForPointerDown(selection, ctx.stickyColumn, ctx.edgeAffinity, e.shiftKey);

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
			prevFocusPath,
			ctx.selectedWidget
		);
		if (handled) {
			e.preventDefault();
			return true;
		}
	}

	if (!e.shiftKey) {
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset = press.anchorOffset ?? offsetFromViewportPoint(el, e.clientX, e.clientY);
		if (offset === null) return false;
		// SelectionState normalizes table endpoints on cross-block entry, so the raw block path
		// is a valid anchor here.
		const anchorPoint = { path: myPath.slice(), offset };
		const lifetimeSignal = ctx.getEditorLifetime();
		if (!lifetimeSignal) {
			devWarn(
				'cross-block-dispatch',
				'editor lifetime signal unavailable; skipping drag install to avoid document-listener leak on unmount'
			);
			return false;
		}
		installDragListener(
			{
				editorRoot: root,
				// The root is the hit-test boundary; what scrolls may be an ancestor in host-scroll
				// mode, so the two resolve separately.
				scrollContainer: ctx.getScrollHost() ?? root,
				selection,
				getBlockElByPath: ctx.getBlockElByPath,
				lifetimeSignal,
				paintSameBlock: press.paintSameBlock
			},
			anchorPoint,
			e
		);
	}

	return false;
}
