/**
 * Pointer half of the cross-block dispatcher: shift-click extension and
 * pointer-drag entry. See cross-block-dispatch.ts for the composer that
 * wires this together with the keydown half.
 */

import type { CrossBlockDispatchContext } from './cross-block-dispatch';
import { handleShiftClick } from './keyboard-extend';
import { findBlockPathForElement } from './path-lookup';
import { clearNativeSelection, offsetFromViewportPoint } from './native-bridge';
import { installDragListener } from './drag-pointer';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockPointer {
	handlePointerDown(e: PointerEvent): boolean;
}

export function createCrossBlockPointer(ctx: CrossBlockDispatchContext): CrossBlockPointer {
	return {
		handlePointerDown: (e) => handlePointerDown(ctx, e)
	};
}

// ── Pointer ────────────────────────────────────────────────────────────────

function handlePointerDown(ctx: CrossBlockDispatchContext, e: PointerEvent): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection } = ctx;
	const myPath = ctx.getMyPath();

	ctx.stickyColumn.reset();
	selection.resetSelectAllCount();

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

	if (selection.isCrossBlock && !e.shiftKey) {
		selection.clear();
		clearNativeSelection();
	}

	if (!e.shiftKey) {
		const root = ctx.getEditorRoot();
		if (!root) return false;
		const offset = offsetFromViewportPoint(el, e.clientX, e.clientY);
		if (offset === null) return false;
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
				scrollContainer: root,
				selection,
				getBlockElByPath: ctx.getBlockElByPath,
				lifetimeSignal
			},
			{ path: myPath.slice(), offset }
		);
	}

	return false;
}
