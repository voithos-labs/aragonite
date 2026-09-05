/** Constructors for list and listItem CST nodes. */

import type { CstNode, ListItemMetadata, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { cloneMetadata, cloneNode } from '../clone';
import { parseFirstBlock } from '../parse-block';
import { renumberOrderedListFrom } from './ordered-markers';
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
	renumberOrderedListFrom(half, startNumber);
	rebuildListRaw(half);
	return half;
}

/**
 * A listItem mirroring `template`'s metadata/affixes. `children` are placed verbatim —
 * clone before passing if they are still referenced from the source tree.
 */
export function buildListItemWithContent(template: NodeView, children: CstNode[]): CstNode {
	const metadata = template.metadata
		? (cloneMetadata(template.metadata) as ListItemMetadata)
		: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null };
	return mintListItem(metadata, template.innerPrefix ?? '', template.innerSuffix ?? '', children);
}

/**
 * A listItem from explicit metadata with empty affixes, for sites deriving a fresh marker
 * rather than mirroring a source item. `children` are placed verbatim.
 */
export function buildListItem(metadata: ListItemMetadata, children: CstNode[]): CstNode {
	return mintListItem(metadata, '', '', children);
}

// Affixes are set before the rebuild, which derives the item's raw from them.
function mintListItem(
	metadata: ListItemMetadata,
	innerPrefix: string,
	innerSuffix: string,
	children: CstNode[]
): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata,
		innerPrefix,
		children,
		childIds: assignIds(children),
		innerSuffix
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

/**
 * The leading and trailing items replacing `item` when a paste splits it at
 * `(innerIndex, offset)`. Either side is null when the caret sits flush against a
 * boundary. `targetRaw` overrides the target leaf's bytes, as in `splitLeafForPaste`.
 */
export function buildSplitItems(
	item: CstNode,
	innerIndex: number,
	offset: number,
	targetRaw?: string
): { leadingItem: CstNode | null; trailingItem: CstNode | null } {
	if (!item.children) return { leadingItem: null, trailingItem: null };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { leadingItem: null, trailingItem: null };

	const { leadingNode, trailingNode } = splitLeafForPaste(
		targetLeaf,
		offset,
		targetRaw ?? targetLeaf.raw
	);

	const leadingChildren: CstNode[] = item.children.slice(0, innerIndex).map(cloneNode);
	if (leadingNode) leadingChildren.push(leadingNode);

	const trailingChildren: CstNode[] = [];
	if (trailingNode) trailingChildren.push(trailingNode);
	for (const c of item.children.slice(innerIndex + 1)) trailingChildren.push(cloneNode(c));
	if (trailingChildren[0]) trailingChildren[0].leadingTrivia = '';

	return {
		leadingItem:
			leadingChildren.length > 0 ? buildListItemWithContent(item, leadingChildren) : null,
		trailingItem:
			trailingChildren.length > 0 ? buildListItemWithContent(item, trailingChildren) : null
	};
}
