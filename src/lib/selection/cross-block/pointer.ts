/** The pointer half of cross-block dispatch: shift-click extension and starting a drag-select. */

import type { CrossBlockDispatchContext, PointerPressOptions } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import type { CaretMemory } from '../../caret/caret-memory';
import { handleShiftClick } from '../keyboard-extend';
import { findBlockPathForElement } from '../path-lookup';
import { applyCollapsedCaret, clearNativeSelection } from '../native-bridge';
import { isInPaddingRow, offsetFromViewportPoint } from '../../caret/point-offset';
import { installDragListener } from '../drag-pointer';
import { devWarn } from '../../dev-warn';
import { isWholeBlockInputProxy } from '../../editor-actions/whole-block-focus-surface';

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
	const padding = armPaddingPress(el, myPath, e);

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
		if (press.ownDrag) {
			press.ownDrag(padding);
			return false;
		}
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset =
			press.anchorOffset ?? padding?.offset ?? offsetFromViewportPoint(el, e.clientX, e.clientY);
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
				paintSameBlock: () => press.paintSameBlock === true || padding?.placed() === true
			},
			anchorPoint,
			e
		);
	}

	return false;
}

// ── A press in the padding rows ────────────────────────────────────────────

/** A primary press in a surface's top or bottom padding, which the editor places itself. */
export interface PaddingPress {
	/** Where the press lands: the column under it, on the nearest line. */
	offset: number;
	/** Whether the press was a single click the editor placed, so no native drag runs under it. */
	placed(): boolean;
}

const armedPresses = new WeakMap<HTMLElement, AbortController>();

// Mac and Linux place a press above the first line or below the last at that line's start or
// end. The mousedown is cancelled, not the pointerdown, which would swallow a double click's.
function armPaddingPress(el: HTMLElement, path: number[], e: PointerEvent): PaddingPress | null {
	armedPresses.get(el)?.abort();
	if (e.button !== 0 || !e.isPrimary || e.shiftKey || !el.isContentEditable) return null;
	if (!isInPaddingRow(el, e.clientX, e.clientY)) return null;
	const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
	if (offset === null) return null;
	const armed = new AbortController();
	armedPresses.set(el, armed);
	let placed = false;
	const place = (down: MouseEvent) => {
		armed.abort();
		// A later click of a run is the multi-click gesture's, which reads the same probe.
		if (down.button !== 0 || down.detail > 1) return;
		down.preventDefault();
		el.focus({ preventScroll: true });
		applyCollapsedCaret(el, { path, offset });
		placed = true;
	};
	el.addEventListener('mousedown', place, { signal: armed.signal });
	return { offset, placed: () => placed };
}

/** A right-click places a collapsed caret where a primary click would, before a menu reads it.
 *  Bound in the capture phase at the editor root, so it runs ahead of every block's own menu. */
export function placeContextPress(selection: SelectionState, e: MouseEvent): void {
	if (e.button !== 2 || selection.isCrossBlock) return;
	const surface = editingHostOf(e.target);
	if (!surface || !isInPaddingRow(surface, e.clientX, e.clientY)) return;
	// A right-click inside a range keeps it for the menu, as the browser does.
	if (!(window.getSelection()?.isCollapsed ?? true)) return;
	const offset = offsetFromViewportPoint(surface, e.clientX, e.clientY);
	const path = findBlockPathForElement(surface);
	if (offset !== null && path) applyCollapsedCaret(surface, { path, offset });
}

function editingHostOf(target: EventTarget | null): HTMLElement | null {
	let el = target instanceof HTMLElement && target.isContentEditable ? target : null;
	while (el?.parentElement?.isContentEditable) el = el.parentElement;
	return el && !isWholeBlockInputProxy(el) ? el : null;
}
