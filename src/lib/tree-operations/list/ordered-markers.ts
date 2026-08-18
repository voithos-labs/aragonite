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
 * Renumber an ordered list's items in place from `fromIndex`, preserving marker suffixes.
 * `fromIndex = 0` resets the sequence to 1; `renumberOrderedListFrom` owns non-1 bases.
 * Every renumbered item's metadata and raw is WRITTEN, so a live-tree caller must pass
 * `sharing`; construction-time callers on fresh nodes may omit it.
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
 * Renumber an ordered list from an arbitrary `base`: seed item 0's marker with `base`
 * (suffix-preserving), then continue the sequence from item 1. No-op on unordered or
 * childless lists.
 */
export function renumberOrderedListFrom(list: CstNode, base: number, sharing?: SharingState): void {
	if (!metadataOf(list, 'list')?.ordered) return;
	if (!list.children || list.children.length === 0) return;
	const first = sharing ? ensureUnsharedChild(list, 0, sharing) : list.children[0];
	const meta = metadataOf(first, 'listItem');
	meta.marker = String(base) + (meta.marker.replace(/^\d+/, '') || '. ');
	rebuildListItemRaw(first);
	renumberOrderedList(list, 1, sharing);
}

// ── Style templating ─────────────────────────────────────────────────────────

/**
 * Rewrite `item`'s marker style to match `parentList`, templating the suffix from a
 * sibling so the destination list's choices are preserved. Numbers stay the caller's
 * renumber pass's job: only the glyph and punctuation suffix reconcile here.
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
 * Rewrite pasted items' markers to the enclosing list's style: an unordered list templates
 * the bullet glyph, an ordered list continues the sequence from `firstIndex`. Runs BEFORE
 * any splice: `$state` wraps entries lazily, so a marker written to a newly-spliced item
 * bypasses reactivity.
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
