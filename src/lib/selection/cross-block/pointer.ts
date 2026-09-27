/** The pointer half of cross-block dispatch: shift-click extension and starting a drag-select. */

import type { CrossBlockDispatchContext, PointerPressOptions } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import type { CaretMemory } from '../../cursor/caret-memory';
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

/** The pointerdown reset every cross-block-aware block shares, the pointer counterpart of
 *  `caret-doors.ts`: a plain click ends any range, so a fresh drag starts its own. */
export function resetForPointerDown(
	selection: SelectionState,
	caretMemory: Pick<CaretMemory, 'forget'>,
	isShift: boolean
): void {
	caretMemory.forget();
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

	resetForPointerDown(selection, ctx.caretMemory, e.shiftKey);

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
