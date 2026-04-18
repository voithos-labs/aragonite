/**
 * Cross-block mutation operations. Delete a cross-block selection range,
 * push undo, collapse, and restore the native caret in the merged block.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import { applyCollapsedCaret } from './native-bridge';
import { rangeDelete } from './range-delete';

// ── Public API ─────────────────────────────────────────────────────────────

/** Everything a cross-block mutation needs from the calling block component. */
export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	pushUndoSnapshot: () => void;
	notifyDocMutated: () => void;
}

/**
 * Run rangeDelete on the current cross-block selection, push undo, collapse,
 * and restore the native caret in the merged block. Returns the collapsed
 * caret position, or null if the selection wasn't cross-block.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	afterReactivity: () => Promise<void>
): Promise<SelectionPoint | null> {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	ctx.pushUndoSnapshot();
	const { collapsedCaret } = rangeDelete(ctx.getDoc(), start, end);
	ctx.selection.collapse();
	ctx.notifyDocMutated();

	await afterReactivity();

	const blockEl = ctx.getBlockElByPath(collapsedCaret.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, collapsedCaret);
		blockEl.focus();
	}
	return collapsedCaret;
}

/**
 * Synchronous variant for compositionstart — no await, no caret restore.
 * Returns the collapsed caret position or null.
 */
export function performCrossBlockDeleteSync(ctx: CrossBlockMutationContext): SelectionPoint | null {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	ctx.pushUndoSnapshot();
	const { collapsedCaret } = rangeDelete(ctx.getDoc(), start, end);
	ctx.selection.collapse();
	ctx.notifyDocMutated();
	return collapsedCaret;
}

// ── Internal ───────────────────────────────────────────────────────────────

function resolveStartEnd(selection: SelectionState): {
	start: SelectionPoint | null;
	end: SelectionPoint | null;
} {
	if (!selection.isCrossBlock) return { start: null, end: null };
	return { start: selection.start, end: selection.end };
}
