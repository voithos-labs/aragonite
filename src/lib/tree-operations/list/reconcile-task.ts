/**
 * Reconcile listItem task metadata against its first paragraph's raw. The parser stores
 * the task marker on the item's metadata, but live typing only mutates `paragraph.raw`, so
 * without this, typing `[ ] ` serializes as a task the live CST still calls plain.
 */

import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { isBareHeadingOpener } from '../../core/parsers/heading';

const TASK_REGEX = /^\[( |x|X)\]\s+/;

/**
 * Align the item's task fields with what a fresh parse of its first line would produce.
 * On demote the stripped marker bytes are restored into the paragraph raw, so the user's
 * content survives.
 */
export function reconcileTaskMetadata(listItem: CstNode): void {
	if (listItem.kind !== 'listItem') return;
	const firstChild = listItem.children?.[0];
	if (!firstChild) return;

	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return;

	if (firstChild.kind !== 'paragraph') {
		// A task marker stands before a PARAGRAPH (GFM § 5.3). The first block just became
		// something else — `Mod+1`, or `# ` typed at its start — so the checkbox goes with the
		// paragraph it belonged to, rather than staying to scale itself to an h1 line. The one
		// exception is the bare `#` a paragraph passes through on its way to `#tag`: a heading
		// to the parser for a single keystroke, and taking the box then would strip a to-do
		// for typing a tag into it.
		if (meta.taskItem && !(firstChild.kind === 'heading' && isBareHeadingOpener(firstChild.raw))) {
			meta.taskItem = false;
			meta.taskMarker = null;
			meta.taskChecked = false;
		}
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
