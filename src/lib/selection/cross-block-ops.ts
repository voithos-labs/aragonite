/**
 * Cross-block mutation operations. Delete a cross-block selection range,
 * push undo, collapse, and restore the native caret in the merged block.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import type { UndoController } from '../components/editor-actions/deps';
import { applyCollapsedCaret } from './native-bridge';
import { rangeDelete } from './range-delete';
import type { StructuralChange } from '../tree-operations/structural-change';

// ── Public API ─────────────────────────────────────────────────────────────

/** Everything a cross-block mutation needs from the calling block component. */
export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	controller: UndoController;
	/**
	 * Push an undo snapshot immediately, without the debounce. Used by the
	 * paste path to fold the cross-block delete and the paste splice into a
	 * single undo entry.
	 */
	pushUndoSnapshot: () => void;
	/** Trigger top-level reactivity. Used by the sync variant and legacy paths. */
	notifyDocMutated: () => void;
}

/**
 * Run rangeDelete on the current cross-block selection, commit via the
 * controller, collapse, and restore the native caret in the merged block.
 * Returns the collapsed caret position, or null if the selection wasn't
 * cross-block.
 *
 * `options.skipSnapshot` is for callers that have already pushed a snapshot
 * covering this delete (e.g., the cross-block paste path, which folds the
 * range-delete and the splice into a single undo entry).
 *
 * `options.skipCaretRestore` skips the post-tick caret restore — useful
 * when the caller plans to mutate the doc further after the delete and
 * will install a final caret itself.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: { skipSnapshot?: boolean; skipCaretRestore?: boolean }
): Promise<SelectionPoint | null> {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	let collapsedCaret: SelectionPoint | null = null;

	await ctx.controller.commitStructural(
		start.path[0],
		start.offset,
		(topLevelChildren) => {
			// proxyDoc lets rangeDelete operate on the commit primitive's
			// children copy instead of the live doc.children array.
			const proxyDoc = { children: topLevelChildren } as Document;
			const beforeLen = topLevelChildren.length;
			const result = rangeDelete(proxyDoc, start, end);
			collapsedCaret = result.collapsedCaret;
			const afterLen = topLevelChildren.length;
			ctx.selection.collapse();
			return topLevelStructuralChange(start.path, end.path, beforeLen, afterLen);
		},
		!options?.skipCaretRestore
			? () => {
					if (collapsedCaret) {
						const blockEl = ctx.getBlockElByPath(collapsedCaret.path);
						if (blockEl) {
							applyCollapsedCaret(blockEl, collapsedCaret);
							blockEl.focus();
						}
					}
				}
			: undefined,
		{
			skipSnapshot: options?.skipSnapshot,
			op: { kind: 'delete', detail: { crossBlock: true } }
		}
	);

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

/**
 * Compute the StructuralChange descriptor for the top-level children array
 * after a rangeDelete. The array has already been mutated in-place.
 *
 * Cases:
 * - Both endpoints in the same top-level block: no top-level splice → noop
 * - Start is top-level (path.length===1): [startTop..endTop] replaced by
 *   merged result; surviving items inherit their old IDs via idMap
 * - Start is nested: [startTop+1..endTop] deleted; start block modified
 *   in-place; idMap preserves IDs for all surviving items
 */
function topLevelStructuralChange(
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	const startTop = startPath[0];
	const endTop = endPath[0];
	const removed = beforeLen - afterLen;

	if (removed === 0) return { op: 'noop' };

	const count = endTop - startTop + 1;
	const newCount = count - removed;

	// The item at startTop always survives (either as the merged block or as the
	// in-place-modified container). idMap[0] = 0 preserves its block ID.
	// If end is nested (endTop item modified in-place, not deleted), it also
	// survives as the last item in the new range — preserve its ID too.
	const endIsTopLevel = endPath.length === 1;
	const idMap: Record<number, number> = { 0: 0 };
	if (!endIsTopLevel && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: startTop, count, newCount, idMap };
}
