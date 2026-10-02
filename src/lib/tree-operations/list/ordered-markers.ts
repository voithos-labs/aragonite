/** Ordered-list marker bookkeeping: reads, renumbering, and matching item style to a list. */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import type { SharingState } from '../sharing';
import { rebuildListItemRaw } from '../../schema/container-rebuilders';
import { ensureUnsharedChild } from '../unshare';

// ── Marker reads ─────────────────────────────────────────────────────────────

/** Read an item's marker as an integer base, defaulting to 1 for non-numeric markers. */
export function orderedBaseOf(item: NodeView | undefined): number {
	if (!item) return 1;
	const marker = metadataOf(item, 'listItem')?.marker ?? '';
	const n = parseInt(marker, 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The punctuation suffix (`. ` or `) `) from a list's first item; defaults to `. `. */
export function readOrderedSuffix(list: NodeView): string {
	const first = list.children?.[0];
	if (!first) return '. ';
	const marker = metadataOf(first, 'listItem')?.marker ?? '1. ';
	return marker.replace(/^\d+/, '') || '. ';
}

// ── Renumbering ──────────────────────────────────────────────────────────────

/** Increment an ordered marker's numeric prefix, preserving its suffix. */
export function bumpOrderedMarker(marker: string): string {
	return marker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
}

/**
 * Renumber an ordered list's items from `fromIndex`, keeping marker suffixes. Each item's metadata
 * and raw is written, so each is copied out of the undo snapshot first.
 */
export function renumberOrderedList(list: CstNode, fromIndex: number, sharing: SharingState): void {
	if (!list.children) return;
	if (!metadataOf(list, 'list')?.ordered) return;
	for (let j = fromIndex; j < list.children.length; j++) {
		const item = ensureUnsharedChild(list, j, sharing);
		const prevNum =
			j > 0 ? parseInt(metadataOf(list.children[j - 1], 'listItem').marker, 10) || 0 : 0;
		const meta = metadataOf(item, 'listItem');
		const suffix = meta.marker.replace(/^\d+/, '');
		meta.marker = String(prevNum + 1) + suffix;
		rebuildListItemRaw(item);
	}
}

/** Renumber an ordered list starting at `base`, keeping marker suffixes. */
export function renumberOrderedListFrom(list: CstNode, base: number, sharing: SharingState): void {
	if (!metadataOf(list, 'list')?.ordered) return;
	if (!list.children || list.children.length === 0) return;
	const first = ensureUnsharedChild(list, 0, sharing);
	const meta = metadataOf(first, 'listItem');
	meta.marker = String(base) + (meta.marker.replace(/^\d+/, '') || '. ');
	rebuildListItemRaw(first);
	renumberOrderedList(list, 1, sharing);
}

// ── Style templating ─────────────────────────────────────────────────────────

/**
 * Rewrite `item`'s marker glyph and suffix to match `parentList`'s first item; the number is left
 * to the caller's renumber pass.
 */
export function normalizeItemMarkerToList(item: CstNode, parentList: CstNode): void {
	const parentOrdered = metadataOf(parentList, 'list')?.ordered ?? false;
	const meta = metadataOf(item, 'listItem');
	const itemOrdered = /^\d/.test(meta.marker);

	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? metadataOf(siblings[0], 'listItem').marker : undefined;

	let target: string;
	if (parentOrdered) {
		const suffix = templateMarker?.replace(/^\d+/, '');
		target = itemOrdered
			? meta.marker.replace(/\D.*$/, '') + (suffix || '. ')
			: '1' + (suffix ?? '. ');
	} else {
		target = templateMarker ?? '- ';
	}
	if (meta.marker === target) return;
	meta.marker = target;
	rebuildListItemRaw(item);
}

/**
 * Rewrite pasted items' markers to the enclosing list's style before the splice, since `$state`
 * wraps entries lazily and a marker written to an item already spliced would bypass reactivity.
 */
export function templatePastedItemMarkers(
	items: CstNode[],
	outer: CstNode,
	firstIndex: number
): void {
	if (outer.kind !== 'list') return;
	if (metadataOf(outer, 'list')?.ordered) {
		const suffix = readOrderedSuffix(outer);
		const base = orderedBaseOf(outer.children?.[0]);
		items.forEach((item, i) => {
			const meta = metadataOf(item, 'listItem');
			if (!meta) return;
			meta.marker = String(base + firstIndex + i) + suffix;
			rebuildListItemRaw(item);
		});
	} else {
		for (const item of items) normalizeItemMarkerToList(item, outer);
	}
}
