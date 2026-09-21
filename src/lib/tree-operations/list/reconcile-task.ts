/**
 * Reconcile listItem task metadata against its first paragraph's raw. The parser stores
 * the task marker on the item's metadata, but live typing only mutates `paragraph.raw`, so
 * without this, typing `[ ] ` serializes as a task the live CST still calls plain.
 */

import type { CstNode, ListItemMetadata } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import { isBareHeadingOpener } from '../../core/parsers/heading';
import type { GrammarView } from '../../schema/block-openers';
import { lineOpensAs } from '../content-write';

const TASK_REGEX = /^\[( |x|X)\]\s+/;

/**
 * Align the item's task fields with what a fresh parse of its first line would produce.
 * On demote the stripped marker bytes are restored into the paragraph raw, so the user's
 * content survives. `previousRaw` is the item's bytes from before the write being reconciled:
 * an item that already stood without a first paragraph keeps the marker it was loaded with.
 */
export function reconcileTaskMetadata(
	listItem: CstNode,
	previousRaw: string,
	grammar?: GrammarView
): void {
	if (listItem.kind !== 'listItem') return;
	const firstChild = listItem.children?.[0];
	if (!firstChild) return;

	const meta = metadataOf(listItem, 'listItem');
	if (!meta) return;

	if (firstChild.kind !== 'paragraph') {
		// A task marker stands before a paragraph (GFM § 5.3), so the write that re-kinds the first
		// block gives the checkbox up with it. The bare `#` on the way to `#tag` is not that write.
		if (!meta.taskItem) return;
		if (firstChild.kind === 'heading' && isBareHeadingOpener(firstChild.raw)) return;
		if (!writeTookTheParagraph(meta, previousRaw, grammar)) return;
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

/** Whether this write is what left the item without a first paragraph, read off the bytes it
 *  had before: there the marker stood in front of a line that still opened as one. */
function writeTookTheParagraph(
	meta: ListItemMetadata,
	previousRaw: string,
	grammar: GrammarView | undefined
): boolean {
	const prefix = (meta.marker ?? '') + (meta.taskMarker ?? '');
	if (!previousRaw.startsWith(prefix)) return true;
	const before = previousRaw.slice(prefix.length);
	const lineEnd = before.indexOf('\n');
	return lineOpensAs(lineEnd === -1 ? before : before.slice(0, lineEnd), grammar) === 'paragraph';
}
