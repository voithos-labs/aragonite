/**
 * Ordered-list marker bookkeeping: renumbering an ordered list's items and
 * normalizing an item's marker style to match its parent list (ordered ↔
 * unordered). Pure tree mutations — no Svelte, no DOM.
 */

import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import type { SharingState } from '../../undo/sharing';
import { rebuildListItemRaw } from '../../schema/container-raw';
import { ensureUnsharedChild } from '../unshare';

/**
 * Renumber an ordered list's items in place starting at `fromIndex`. No-op
 * on unordered lists. Preserves each item's marker suffix (`. ` vs `) `).
 *
 * When `fromIndex` is 0 this resets the sequence to 1, not to the list's
 * original start number. Callers that need a non-1 base must seed item 0
 * manually and then call with `fromIndex=1`.
 *
 * Every renumbered item's metadata + raw is WRITTEN — live-tree callers must
 * pass `sharing` (the list itself already owned) so each item is unshared
 * first; construction-time callers operating on fresh nodes may omit it.
 */
export function renumberOrderedList(list: CstNode, fromIndex = 0, sharing?: SharingState): void {
	if (!list.children) return;
	if (!metadataOf(list, 'list')?.ordered) return;
	for (let j = fromIndex; j < list.children.length; j++) {
		const item = sharing ? ensureUnsharedChild(list, j, sharing) : list.children[j];
		const prevNum =
			j > 0 ? parseInt(metadataOf(list.children[j - 1], 'listItem').marker, 10) || 0 : 0;
		const meta = metadataOf(item, 'listItem');
		const suffix = meta.marker.replace(/^\d+/, '');
		meta.marker = String(prevNum + 1) + suffix;
		rebuildListItemRaw(item);
	}
}

/**
 * Rewrite `item`'s marker so its style matches `parentList` (ordered ↔
 * unordered). Templates the suffix (`*`/`+`/`-` or `.`/`)`) from a sibling
 * so destination-list choices are preserved. No-op when already matching.
 * Caller renumbers afterward — this only touches marker style.
 */
export function normalizeItemMarkerToList(item: CstNode, parentList: CstNode): void {
	const parentOrdered = metadataOf(parentList, 'list')?.ordered ?? false;
	const meta = metadataOf(item, 'listItem');
	const itemOrdered = /^\d/.test(meta.marker);
	if (itemOrdered === parentOrdered) return;

	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? metadataOf(siblings[0], 'listItem').marker : undefined;

	if (parentOrdered) {
		const suffix = templateMarker?.replace(/^\d+/, '') ?? '. ';
		meta.marker = '1' + suffix;
	} else {
		meta.marker = templateMarker ?? '- ';
	}
	rebuildListItemRaw(item);
}
