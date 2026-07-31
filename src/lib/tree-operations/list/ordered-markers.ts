/** Ordered-list marker bookkeeping: renumbering, and matching an item's style to its list. */

import type { CstNode } from '../../core/nodes';
import { metadataOf } from '../../core/nodes';
import type { SharingState } from '../sharing';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { ensureUnsharedChild } from '../unshare';

/** Increment an ordered marker's numeric prefix, preserving its suffix. */
export function bumpOrderedMarker(marker: string): string {
	return marker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
}

/**
 * Renumber an ordered list's items in place from `fromIndex`, preserving marker suffixes.
 * `fromIndex = 0` resets the sequence to 1, so a caller needing a non-1 base seeds item 0
 * itself and passes 1. Every renumbered item's metadata and raw is WRITTEN, so a live-tree
 * caller must pass `sharing`; construction-time callers on fresh nodes may omit it.
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
 * Rewrite `item`'s marker style to match `parentList`, templating the suffix from a
 * sibling so the destination list's choices are preserved. The caller renumbers afterward.
 */
export function normalizeItemMarkerToList(item: CstNode, parentList: CstNode): void {
	const parentOrdered = metadataOf(parentList, 'list')?.ordered ?? false;
	const meta = metadataOf(item, 'listItem');
	const itemOrdered = /^\d/.test(meta.marker);

	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? metadataOf(siblings[0], 'listItem').marker : undefined;

	if (parentOrdered) {
		// Already ordered: only number/suffix can differ, and the caller's renumber handles
		// both.
		if (itemOrdered) return;
		meta.marker = '1' + (templateMarker?.replace(/^\d+/, '') ?? '. ');
	} else {
		const target = templateMarker ?? '- ';
		if (meta.marker === target) return;
		meta.marker = target;
	}
	rebuildListItemRaw(item);
}
