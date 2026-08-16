/** Constructors for list and listItem CST nodes. */

import type { CstNode, ListItemMetadata, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { cloneMetadata } from '../clone';
import { parseFirstBlock } from '../parse-block';
import { renumberOrderedList } from './ordered-markers';
import { assignIds } from '../../block-id';

// ── List / item construction ─────────────────────────────────────────────────

/**
 * A list node carrying `items`, mirroring `template`'s metadata and affixes and
 * renumbering ordered markers from `startNumber`. Items are mutated in place.
 */
export function assembleListHalf(
	template: NodeView,
	items: CstNode[],
	startNumber: number
): CstNode {
	const half: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata
			? (cloneMetadata(template.metadata) as ListMetadata)
			: { ordered: false },
		children: items,
		childIds: assignIds(items),
		innerPrefix: template.innerPrefix ?? '',
		innerSuffix: template.innerSuffix ?? ''
	};
	if (items[0]) items[0].leadingTrivia = '';
	for (const item of items) rebuildListItemRaw(item);

	// renumberOrderedList's fromIndex=0 path always restarts at 1, so seed items[0]
	// manually to renumber from an arbitrary base.
	const ordered = metadataOf(half, 'list')?.ordered ?? false;
	if (ordered && items.length > 0) {
		const firstMeta = metadataOf(items[0], 'listItem');
		const suffix = firstMeta.marker.replace(/^\d+/, '') || '. ';
		firstMeta.marker = String(startNumber) + suffix;
		rebuildListItemRaw(items[0]);
		renumberOrderedList(half, 1);
	}
	rebuildListRaw(half);
	return half;
}

/**
 * A listItem mirroring `template`'s metadata/affixes. `children` are placed verbatim —
 * clone before passing if they are still referenced from the source tree.
 */
export function buildListItemWithContent(template: NodeView, children: CstNode[]): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata
			? (cloneMetadata(template.metadata) as ListItemMetadata)
			: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
		innerPrefix: template.innerPrefix ?? '',
		children,
		childIds: assignIds(children),
		innerSuffix: template.innerSuffix ?? ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	return item;
}

/**
 * A listItem from explicit metadata with empty affixes, for sites deriving a fresh marker
 * rather than mirroring a source item. `children` are placed verbatim.
 */
export function buildListItem(metadata: ListItemMetadata, children: CstNode[]): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata,
		innerPrefix: '',
		children,
		childIds: assignIds(children),
		innerSuffix: ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	return item;
}

/**
 * A bare list shell with empty raw. Unlike `assembleListHalf` it neither renumbers nor
 * rebuilds raw; a live-tree caller owns that and must route it through `sharing` so the
 * moved items are unshared before being written (`unshare.ts`).
 */
export function buildListShell(ordered: boolean, children: CstNode[]): CstNode {
	const metadata: ListMetadata = { ordered };
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata,
		children,
		childIds: assignIds(children)
	};
}

// ── Marker helpers ───────────────────────────────────────────────────────────

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

// ── Paste split ──────────────────────────────────────────────────────────────

/**
 * Slice a leaf's raw at `offset` for a paste-style split, re-parsing each half. One
 * leading whitespace is trimmed from the trailing slice, which would otherwise produce
 * double-space markers after a word-boundary split. Null on an empty side. `raw` overrides
 * the leaf's own bytes, which a paste that ran a delete half first supplies.
 */
export function splitLeafForPaste(
	leaf: CstNode,
	offset: number,
	raw: string = leaf.raw
): { leadingNode: CstNode | null; trailingNode: CstNode | null; lineEnding: '\n' | '\r\n' } {
	const lineEnding = trailingLineEnding(raw);
	const display = trimTrailingLineEnding(raw);
	// Off any scalar interior first: the halves become separate items, so a pair cut here is
	// unrecoverable bytes rather than a recoverable edit.
	const cut = snapToScalarBoundary(display, offset);
	const leadingText = display.slice(0, cut);
	const trailingText = display.slice(cut).replace(/^[ \t]/, '');

	const leadingNode = leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding) : null;
	const trailingNode = trailingText.length > 0 ? parseFirstBlock(trailingText + lineEnding) : null;

	return { leadingNode, trailingNode, lineEnding };
}
