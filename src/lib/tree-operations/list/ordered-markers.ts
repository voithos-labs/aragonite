/**
 * Ordered-list marker bookkeeping: renumbering an ordered list's items and
 * normalizing an item's marker style to match its parent list (ordered ↔
 * unordered). Pure tree mutations — no Svelte, no DOM.
 */

import type { CstNode } from '../../core/nodes';
import { rebuildListItemRaw } from '../../schema/container-raw';

/**
 * Renumber an ordered list's items in place starting at `fromIndex`. No-op
 * on unordered lists. Preserves each item's marker suffix (`. ` vs `) `).
 *
 * When `fromIndex` is 0 this resets the sequence to 1, not to the list's
 * original start number. Callers that need a non-1 base must seed item 0
 * manually and then call with `fromIndex=1`.
 */
export function renumberOrderedList(list: CstNode, fromIndex = 0): void {
	if (!list.children) return;
	if (!(list.metadata as { ordered?: boolean } | undefined)?.ordered) return;
	for (let j = fromIndex; j < list.children.length; j++) {
		const prevNum =
			j > 0 ? parseInt((list.children[j - 1].metadata as { marker: string }).marker, 10) || 0 : 0;
		const meta = list.children[j].metadata as { marker: string };
		const suffix = meta.marker.replace(/^\d+/, '');
		meta.marker = String(prevNum + 1) + suffix;
		rebuildListItemRaw(list.children[j]);
	}
}

/**
 * Rewrite `item`'s marker so its style matches `parentList` (ordered ↔
 * unordered). Templates the suffix (`*`/`+`/`-` or `.`/`)`) from a sibling
 * so destination-list choices are preserved. No-op when already matching.
 * Caller renumbers afterward — this only touches marker style.
 */
export function normalizeItemMarkerToList(item: CstNode, parentList: CstNode): void {
	const parentOrdered =
		(parentList.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	const meta = item.metadata as { marker: string };
	const itemOrdered = /^\d/.test(meta.marker);
	if (itemOrdered === parentOrdered) return;

	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? (siblings[0].metadata as { marker: string }).marker : undefined;

	if (parentOrdered) {
		const suffix = templateMarker?.replace(/^\d+/, '') ?? '. ';
		meta.marker = '1' + suffix;
	} else {
		meta.marker = templateMarker ?? '- ';
	}
	rebuildListItemRaw(item);
}
