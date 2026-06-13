/**
 * Ensure a list item's `raw` ends with a line ending. Pasted items cloned
 * from clipboards without trailing newlines otherwise cause `rebuildListRaw`
 * to concatenate adjacent items' raws, mashing `"6. Ordered"` and `"7. third"`
 * into one line `"6. Ordered7. third"` — which re-parses as one item.
 *
 * Round-trip invariant: items at parse time keep their original no-newline
 * state (the parser populates `raw` directly without calling this helper);
 * only callers that splice items mid-list need to normalize.
 */

import type { CstNode } from '../../core/nodes';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';

export function ensureListItemNewlineTerminated(item: CstNode): void {
	if (item.raw.endsWith('\n')) return;
	if (!item.children || item.children.length === 0) {
		item.raw += '\n';
		return;
	}
	const last = item.children[item.children.length - 1];
	if (!last.raw.endsWith('\n')) last.raw += '\n';
	rebuildListItemRaw(item);
}

/** Normalize every pasted listItem in `items` (non-listItems pass through). */
export function newlineTerminateListItems(items: CstNode[]): void {
	for (const item of items) {
		if (item.kind === 'listItem') ensureListItemNewlineTerminated(item);
	}
}

/**
 * THE way pasted items enter a list's children mid-array: termination is
 * welded to the splice so a new paste path can't forget it and reintroduce
 * raw-mashing during the container's rebuild.
 */
export function spliceTerminatedItems(
	children: CstNode[],
	at: number,
	removeCount: number,
	items: CstNode[]
): void {
	newlineTerminateListItems(items);
	children.splice(at, removeCount, ...items);
}
