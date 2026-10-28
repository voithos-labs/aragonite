/**
 * The keystroke's two helpers around its write: the trial reparse that picks between a commit and
 * the in-place write, and putting the caret back after a write that moved it.
 */

import { updateNodeContent, writtenOpenerCloser } from '../tree-operations/content-write';
import type { LegalWrite, WriteTarget } from '../tree-operations/content-write';
import { makeBlockNode, metadataOf } from '../core/nodes';
import { documentLineEnding } from '../core/lines';
import {
	replacePreservingFirst,
	type StructuralChange
} from '../tree-operations/structural-change';
import { createSharingState } from '../tree-operations/sharing';
import { followsTaskMarker } from '../tree-operations/list/task-paragraph';
import { readBlockPath } from '../selection/path-lookup';
import type { CaretPosition } from '../selection/primitives';
import type { Relanding } from '../action-contracts';

// ── Trial reparse ────────────────────────────────────────────────────────────

/**
 * Run the content write on a throwaway copy of child `index` to pick a commit or the in-place
 * write. The last block brings the trailing blank line, since blanking it makes that line a block.
 */
export function previewContentReparse(
	target: WriteTarget,
	index: number,
	write: LegalWrite,
	grammar: Parameters<typeof updateNodeContent>[3]
): StructuralChange {
	// The trial holds no block below, so an opener the write closes against them is decided here.
	if (writtenOpenerCloser(target, index, write.text, grammar) !== null) {
		return replacePreservingFirst(index, 1, 1);
	}
	const node = target.children[index];
	const owner = 'owner' in target ? target.owner : undefined;
	const tailSuffix =
		index === target.children.length - 1 && 'suffix' in target ? target.suffix : '';
	const lineEnding = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
	// The probe heads the trial's body, which separates from nothing, so it holds no line above.
	const probe = makeBlockNode({ kind: node.kind, leadingTrivia: '', raw: node.raw });
	// The owner and its task marker go along as a copy, so the trial reads the bytes the write will.
	const taskItem = followsTaskMarker(owner, index) ? owner : undefined;
	const ownerCopy =
		owner &&
		makeBlockNode({
			kind: owner.kind,
			leadingTrivia: '',
			raw: owner.raw,
			metadata: taskItem ? { ...metadataOf(taskItem, 'listItem') } : undefined,
			children: [probe]
		});
	// The copies are the trial's own, so a fresh sharing state copies none of them.
	return updateNodeContent(
		{ children: [probe], owner: ownerCopy, suffix: tailSuffix, lineEnding },
		0,
		write,
		grammar,
		createSharingState()
	).change;
}

// ── Putting the caret back ───────────────────────────────────────────────────

/** `relanding`'s caret, or null when focus already left the blocks the write wrote. */
export function unlessFocusMoved(relanding: Relanding): CaretPosition | null {
	const { list, at, count } = relanding.window;
	return focusMovedOutsideReplacement(list, at, count) ? null : relanding.caret;
}

/** Whether focus has left the written blocks, as after a blur commit, where putting the caret
 *  back would pull it away from where the user went. */
export function focusMovedOutsideReplacement(
	scopePath: readonly number[],
	at: number,
	count: number
): boolean {
	if (typeof document === 'undefined') return false;
	const host = document.activeElement?.closest?.('[data-block-path]') ?? null;
	// No readable path means a remount removed the focused element, so the caret goes back.
	const path = readBlockPath(host);
	if (!path) return false;
	for (let depth = 0; depth < scopePath.length; depth++) {
		if (path[depth] !== scopePath[depth]) return true;
	}
	const index = path[scopePath.length];
	return index === undefined || index < at || index >= at + count;
}
