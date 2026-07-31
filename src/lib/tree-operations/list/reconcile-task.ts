/**
 * Reconcile listItem task metadata against its first paragraph's raw. The parser stores
 * the task marker on the item's metadata, but live typing only mutates `paragraph.raw` —
 * so without this, typing `[ ] ` serializes as a task the live CST still calls plain.
 */

import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';

const TASK_REGEX = /^\[( |x|X)\]\s+/;

/**
 * Align the item's task fields with what a fresh parse of its first line would produce.
 * On demote the stripped marker bytes are restored into the paragraph raw, so the user's
 * content survives.
 */
export function reconcileTaskMetadata(listItem: CstNode): void {
	if (listItem.kind !== 'listItem') return;
	const firstChild = listItem.children?.[0];
	if (!firstChild || firstChild.kind !== 'paragraph') return;

	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return;

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
			firstChild.raw = effectiveFirstLine.slice(newTaskMarker.length) + restRaw;
		}
		return;
	}

	if (meta.taskItem === true || meta.taskMarker !== null) {
		firstChild.raw = effectiveFirstLine + restRaw;
		meta.taskItem = false;
		meta.taskMarker = null;
		meta.taskChecked = false;
	}
}
