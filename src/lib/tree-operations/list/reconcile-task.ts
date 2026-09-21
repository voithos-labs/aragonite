/**
 * Reconcile listItem task metadata against its first paragraph's raw. The parser stores
 * the task marker on the item's metadata, but live typing only mutates `paragraph.raw`, so
 * without this, typing `[ ] ` serializes as a task the live CST still calls plain.
 */

import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { isBareHeadingOpener } from '../../core/parsers/heading';
import type { SharingState } from '../sharing';
import { ensureUnsharedChild } from '../unshare';

const TASK_REGEX = /^\[( |x|X)\]\s+/;

/** Whether a task marker may stand in front of this block: its own paragraph, or the bare `#` a
 *  line passes through on the way to `#tag`, which is a heading to the parser for one keystroke. */
export function taskMarkerMayStandBefore(block: CstNode): boolean {
	return block.kind === 'paragraph' || (block.kind === 'heading' && isBareHeadingOpener(block.raw));
}

/**
 * Align the item's task fields with what a fresh parse of its first line would produce, after a
 * write to the child at `writtenIndex`. On demote the stripped marker bytes are restored into the
 * paragraph raw, so the user's content survives. `markerStoodBefore` is that same question asked of
 * the block that was in the position before the write: only a write that takes such a block away
 * takes the marker with it, since a document can legitimately load as `- [ ] # note`.
 */
export function reconcileTaskMetadata(
	listItem: CstNode,
	writtenIndex: number,
	markerStoodBefore: boolean,
	sharing?: SharingState
): void {
	if (listItem.kind !== 'listItem' || writtenIndex !== 0) return;
	const firstChild = listItem.children?.[0];
	if (!firstChild) return;

	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return;

	if (firstChild.kind !== 'paragraph') {
		// A task marker stands before a paragraph (GFM § 5.3), so the write that puts a block there
		// the marker cannot stand in front of gives the checkbox up with the paragraph it had.
		if (!meta.taskItem || !markerStoodBefore) return;
		if (taskMarkerMayStandBefore(firstChild)) return;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
		return;
	}

	const firstLineEnd = firstChild.raw.indexOf('\n');
	const firstLineRaw = firstLineEnd === -1 ? firstChild.raw : firstChild.raw.slice(0, firstLineEnd);
	const restRaw = firstLineEnd === -1 ? '' : firstChild.raw.slice(firstLineEnd);
	const effectiveFirstLine = (meta.taskMarker ?? '') + firstLineRaw;

	const match = effectiveFirstLine.match(TASK_REGEX);

	if (match) {
		const newTaskMarker = match[0];
		const newTaskChecked = match[1].toLowerCase() === 'x';
		const drift =
			meta.taskItem !== true ||
			meta.taskMarker !== newTaskMarker ||
			meta.taskChecked !== newTaskChecked;
		if (drift) {
			meta.taskItem = true;
			meta.taskMarker = newTaskMarker;
			meta.taskChecked = newTaskChecked;
			ownedFirstChild(listItem, sharing).raw =
				effectiveFirstLine.slice(newTaskMarker.length) + restRaw;
		}
		return;
	}

	if (meta.taskItem === true || meta.taskMarker !== null) {
		ownedFirstChild(listItem, sharing).raw = effectiveFirstLine + restRaw;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
	}
}

/** The marker's bytes move between the item's metadata and its first child, so that child is
 *  copied out of the undo snapshot before it is written (`unshare.ts` header). */
function ownedFirstChild(listItem: CstNode, sharing: SharingState | undefined): CstNode {
	return sharing ? ensureUnsharedChild(listItem, 0, sharing) : listItem.children![0];
}
