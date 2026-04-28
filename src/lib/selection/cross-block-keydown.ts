/**
 * Keydown + compositionstart half of the cross-block dispatcher.
 * See cross-block-dispatch.ts for the composer that wires this together
 * with the pointer half.
 */

import type { CrossBlockMutationContext } from './cross-block-ops';
import type { CrossBlockDispatchContext } from './cross-block-dispatch';
import { performCrossBlockDelete, performCrossBlockDeleteSync } from './cross-block-ops';
import {
	collapseCrossBlock,
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	extendFocusToDocEdge,
	selectWholeDocument,
	scrollFocusBlockIntoView
} from './keyboard-extend';
import { ambientSpanOf, placeCaretAfterAmbientSpan } from '../ambient/ambient-dom';
import { createRangeFromOffsets } from '../cursor/cursor-utils';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockKeydown {
	handleKeyDown(e: KeyboardEvent): Promise<boolean>;
	handleCompositionStart(): boolean;
}

export function createCrossBlockKeydown(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext
): CrossBlockKeydown {
	return {
		handleKeyDown: (e) => handleKeyDown(ctx, mutCtx, e),
		handleCompositionStart: () => handleCompositionStart(ctx, mutCtx)
	};
}

// ── Keydown ────────────────────────────────────────────────────────────────

async function handleKeyDown(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const { selection } = ctx;

	if (selection.isCrossBlock) {
		const handled = await handleCrossBlockActive(ctx, mutCtx, e);
		if (handled) return true;
	}

	return handleCrossBlockEntry(ctx, e);
}

/** Keystroke dispatch while cross-block mode is already active. */
async function handleCrossBlockActive(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext,
	e: KeyboardEvent
): Promise<boolean> {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc, getBlockElByPath } = ctx;
	const myPath = ctx.getMyPath();
	const doc = getDoc();

	// Ctrl+C / Ctrl+X intentionally pass through — the synthetic copy/cut event
	// reaches the block's onCopy/onCut, which writes synchronously via
	// e.clipboardData.setData. Tauri's wry webview refuses
	// navigator.clipboard.writeText in some contexts.

	if (e.key === 'Backspace' || e.key === 'Delete') {
		e.preventDefault();
		await performCrossBlockDelete(mutCtx, { tableCoverageDelete: true });
		return true;
	}

	// Delete-then-redispatch: Enter, Shift+Enter, Tab, Ctrl+B, Ctrl+I, Ctrl+0..6
	// are transformative operations the block-level handler resolves at the
	// collapsed caret. Without this, the originating block's onKeyDown runs
	// the op on a stale single-block raw while the cross-block selection
	// visually persists. Delete the range first, then re-dispatch the same
	// key to the newly-focused block so its handler resolves normally.
	if (isDeleteThenRedispatchKey(e)) {
		e.preventDefault();
		await performCrossBlockDelete(mutCtx);
		await ctx.afterReactivity();
		redispatchKeyToActiveElement(e);
		return true;
	}

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		extendFocusToNextBlock(selection, doc, focusEl, focusPath);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
		return true;
	}
	if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
		e.preventDefault();
		const focusPath = selection.focus?.path ?? myPath;
		const focusEl = getBlockElByPath(focusPath) ?? el;
		const side = e.key === 'ArrowUp' ? ('start' as const) : ('end' as const);
		extendFocusToPreviousBlock(selection, doc, focusEl, focusPath, side);
		scrollFocusBlockIntoView(selection, getBlockElByPath);
		return true;
	}

	if (e.key === 'Escape' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
		e.preventDefault();
		collapseCrossBlock(selection, 'start', getBlockElByPath);
		return true;
	}

	if (!e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
		e.preventDefault();
		collapseCrossBlock(selection, 'start', getBlockElByPath);
		return true;
	}
	if (!e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
		e.preventDefault();
		collapseCrossBlock(selection, 'end', getBlockElByPath);
		return true;
	}

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selectWholeDocument(selection, doc, getBlockElByPath);
		return true;
	}

	return false;
}

function handleCrossBlockEntry(ctx: CrossBlockDispatchContext, e: KeyboardEvent): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	const { selection, getDoc } = ctx;

	if (e.ctrlKey && e.shiftKey && e.key === 'End') return handleDocEdgeExtend(ctx, e, 'end');
	if (e.ctrlKey && e.shiftKey && e.key === 'Home') return handleDocEdgeExtend(ctx, e, 'start');

	if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
		e.preventDefault();
		selection.incrementSelectAllCount();
		if (selection.selectAllCount === 1) {
			selectFirstPressContent(el);
			return true;
		}
		selectWholeDocument(selection, getDoc(), ctx.getBlockElByPath);
		return true;
	}

	return false;
}

// ── Keydown Helpers ───────────────────────────────────────────────────────

/**
 * Keys whose behavior is owned by the block-level handler at the caret and
 * which must run at a collapsed caret, not while a cross-block selection
 * visually persists over stale block indices.
 */
function isDeleteThenRedispatchKey(e: KeyboardEvent): boolean {
	if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) return true;
	if (
		(e.ctrlKey || e.metaKey) &&
		!e.shiftKey &&
		!e.altKey &&
		(e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')
	)
		return true;
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[0-6]$/.test(e.key)) return true;
	return false;
}

/**
 * Re-fire the keydown at the post-delete active element. The collapsed caret
 * restore focuses the merge target synchronously, so document.activeElement
 * points at the block whose onKeyDown should handle the key.
 */
function redispatchKeyToActiveElement(e: KeyboardEvent): void {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return;
	active.dispatchEvent(
		new KeyboardEvent('keydown', {
			key: e.key,
			code: e.code,
			shiftKey: e.shiftKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
			altKey: e.altKey,
			bubbles: true,
			cancelable: true
		})
	);
}

/**
 * Select the block's content for the first Ctrl+A press. When a container
 * contributes an ambient marker (e.g. a list item's `- `), anchor after the
 * marker so type-replace doesn't corrupt the contenteditable="false" island.
 */
function selectFirstPressContent(el: HTMLElement): void {
	const ambient = ambientSpanOf(el);
	const ambientLen = ambient?.textContent?.length ?? 0;
	const textLen = el.textContent?.length ?? 0;

	if (ambient && textLen > ambientLen) {
		if (!placeCaretAfterAmbientSpan(el)) return;
		const endRange = createRangeFromOffsets(el, textLen, textLen);
		if (endRange) {
			window.getSelection()?.extend(endRange.endContainer, endRange.endOffset);
		}
		return;
	}

	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

function handleDocEdgeExtend(
	ctx: CrossBlockDispatchContext,
	e: KeyboardEvent,
	direction: 'start' | 'end'
): boolean {
	const el = ctx.getEl();
	if (!el) return false;
	e.preventDefault();
	extendFocusToDocEdge(ctx.selection, ctx.getDoc(), el, ctx.getMyPath(), direction);
	scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
	return true;
}

// ── CompositionStart ───────────────────────────────────────────────────────

function handleCompositionStart(
	ctx: CrossBlockDispatchContext,
	mutCtx: CrossBlockMutationContext
): boolean {
	ctx.stickyColumn.reset();
	if (!ctx.selection.isCrossBlock) return false;
	performCrossBlockDeleteSync(mutCtx);
	return true;
}
