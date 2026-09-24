/**
 * Reconcile listItem task metadata against its first paragraph's raw. The parser stores
 * the task marker on the item's metadata, but live typing only mutates `paragraph.raw`, so
 * without this, typing `[ ] ` serializes as a task the live CST still calls plain.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf, type ListItemMetadata } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { matchTaskCheckbox } from '../../core/parsers/list';
import type { SharingState } from '../sharing';
import { ensureUnsharedChild } from '../unshare';

/** Whether a task marker may stand in front of this block: only its own paragraph (GFM task lists). */
export function taskMarkerMayStandBefore(block: CstNode): boolean {
	return block.kind === 'paragraph';
}

/**
 * Align the item's task fields with what a fresh parse of its first line would produce, after a
 * write to the child at `writtenIndex`. On demote the stripped marker bytes are restored into the
 * paragraph raw, so the user's content survives. `markerStoodBefore` is that same question asked of
 * the block that was in the position before the write: only a write that takes such a block away
 * takes the marker with it, since a document can load with a setext heading or table there.
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

	const firstLineText = firstLineTextOf(firstChild.raw);
	// The first line's ending stays with the rest of the paragraph.
	const restRaw = firstChild.raw.slice(firstLineText.length);
	const { match, kept } = splitTaskLine(meta, firstLineText);

	if (match) {
		const drift =
			meta.taskItem !== true ||
			meta.taskMarker !== match.rawMarker ||
			meta.taskChecked !== match.checked;
		if (drift) {
			meta.taskItem = true;
			meta.taskMarker = match.rawMarker;
			meta.taskChecked = match.checked;
			ownedFirstChild(listItem, sharing).raw = kept + restRaw;
		}
		return;
	}

	if (meta.taskItem === true || meta.taskMarker !== null) {
		ownedFirstChild(listItem, sharing).raw = kept + restRaw;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
	}
}

/**
 * How far a caret in the item's first paragraph moves once `text` is written there and
 * {@link reconcileTaskMetadata} has run: back by a task marker the item takes off the front. Read
 * before the write, while the item still holds its old marker.
 */
export function taskMarkerCaretShift(listItem: NodeView, text: string): number {
	if (listItem.kind !== 'listItem') return 0;
	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return 0;
	const firstLineText = firstLineTextOf(text);
	return splitTaskLine(meta, firstLineText).kept.length - firstLineText.length;
}

/** The checkbox the item's first line reads as once `firstLineText` stands after the item's
 *  current marker, and the text its paragraph keeps: a demoted marker goes back into the text. */
function splitTaskLine(
	meta: Readonly<ListItemMetadata>,
	firstLineText: string
): { match: ReturnType<typeof matchTaskCheckbox>; kept: string } {
	const line = (meta.taskMarker ?? '') + firstLineText;
	const match = matchTaskCheckbox(line);
	if (match) return { match, kept: line.slice(match.rawMarker.length) };
	const demoted = meta.taskItem === true || meta.taskMarker !== null;
	return { match: null, kept: demoted ? line : firstLineText };
}

/** The first line of `raw` without its ending. */
function firstLineTextOf(raw: string): string {
	const end = raw.indexOf('\n');
	return trimTrailingLineEnding(end === -1 ? raw : raw.slice(0, end + 1));
}

/** The marker's bytes move between the item's metadata and its first child, so that child is
 *  copied out of the undo snapshot before it is written (`unshare.ts` header). */
function ownedFirstChild(listItem: CstNode, sharing: SharingState | undefined): CstNode {
	return sharing ? ensureUnsharedChild(listItem, 0, sharing) : listItem.children![0];
}
