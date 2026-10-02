/**
 * Keeps a list item's task metadata in step with its first block. The parser keeps the task marker
 * in the item's metadata, but a write changes only the block, so every write into an item's first
 * slot goes through `writeKeepingTaskMarker`, which reconciles the marker with what stands there.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf, type ListItemMetadata } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { matchTaskCheckbox } from '../../core/parsers/list';
import type { SharingState } from '../sharing';
import { ensureUnsharedChild } from '../unshare';

/** Runs `write` against the child at `slot`, then reconciles the owner's task marker with what
 *  stands there now. Pass the owner as the tree holds it once any copy before the write is made. */
export function writeKeepingTaskMarker<T>(
	owner: CstNode | undefined,
	children: readonly CstNode[],
	slot: number,
	sharing: SharingState,
	write: () => T
): T {
	// Read before the write, which can put a block there no task marker may stand before.
	const stood = children[slot] !== undefined && taskMarkerMayStandBefore(children[slot]);
	const result = write();
	if (owner) reconcileTaskMetadata(owner, slot, stood, sharing);
	return result;
}

/** Whether a task marker may stand in front of this block: only its own paragraph (GFM task lists). */
function taskMarkerMayStandBefore(block: NodeView): boolean {
	return block.kind === 'paragraph';
}

/**
 * Align the item's task fields with a fresh parse of its first line, putting a demoted marker's
 * bytes back in the paragraph; the marker is dropped only if it stood before the replaced block.
 */
export function reconcileTaskMetadata(
	listItem: CstNode,
	writtenIndex: number,
	markerStoodBefore: boolean,
	sharing: SharingState
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
 * How far back a caret in the first paragraph moves when writing `text` there takes a task marker
 * off its front; read before the write, while the item still holds its current marker.
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
function ownedFirstChild(listItem: CstNode, sharing: SharingState): CstNode {
	return ensureUnsharedChild(listItem, 0, sharing);
}
