/**
 * Helpers for constructing list and listItem CST nodes used by Enter-exit
 * and paste flows.
 */

import type { CstNode, ListItemMetadata, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { cloneMetadata } from '../clone';
import { parseFirstBlock } from '../parse-block';
import { renumberOrderedList } from './ordered-markers';
import { freshChildIds } from '../../block-id';

// ── List / item construction ─────────────────────────────────────────────────

/**
 * Construct a list CST node carrying `items`, mirroring `template`'s metadata
 * and inner-prefix/suffix. Renumbers ordered markers starting at `startNumber`
 * (no-op for unordered lists). Items are mutated in place — pass clones if
 * the caller needs to preserve originals.
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
		childIds: freshChildIds(items),
		innerPrefix: template.innerPrefix ?? '',
		innerSuffix: template.innerSuffix ?? ''
	};
	if (items[0]) items[0].leadingTrivia = '';
	for (const item of items) rebuildListItemRaw(item);

	// renumberOrderedList's fromIndex=0 path always restarts at 1 — seed
	// items[0] manually to renumber from an arbitrary base.
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
 * Construct a listItem mirroring `template`'s metadata/affixes around the
 * provided children. `children` are placed verbatim — clone before passing
 * if they are still referenced from the source tree.
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
		childIds: freshChildIds(children),
		innerSuffix: template.innerSuffix ?? ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	return item;
}

/**
 * Construct a listItem from explicit metadata (marker + task fields) around
 * the provided children, with empty affixes. For action-layer sites that
 * derive a fresh marker rather than mirroring a source item's metadata.
 * Children are placed verbatim — clone first if still referenced elsewhere.
 */
export function buildListItem(metadata: ListItemMetadata, children: CstNode[]): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata,
		innerPrefix: '',
		children,
		childIds: freshChildIds(children),
		innerSuffix: ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	return item;
}

/**
 * Construct a bare list shell (kind/ordered/children only, empty raw). Unlike
 * `assembleListHalf` this neither renumbers nor rebuilds raw — the caller owns
 * that, which a live-tree caller must do through its `sharing` state so the
 * moved items are unshared before being written (Design Rule 5).
 */
export function buildListShell(ordered: boolean, children: CstNode[]): CstNode {
	const metadata: ListMetadata = { ordered };
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata,
		children,
		childIds: freshChildIds(children)
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

/**
 * Read the punctuation suffix (`. ` or `) `) from a list's first item.
 * Defaults to `. ` when the list is empty or the first item lacks a marker.
 */
export function readOrderedSuffix(list: NodeView): string {
	const first = list.children?.[0];
	if (!first) return '. ';
	const marker = metadataOf(first, 'listItem')?.marker ?? '1. ';
	return marker.replace(/^\d+/, '') || '. ';
}

// ── Paste split ──────────────────────────────────────────────────────────────

/**
 * Slice a leaf's raw at `offset` for a paste-style split: trims one leading
 * whitespace character from the trailing slice (avoids double-space markers
 * after word-boundary splits) and re-parses each half as its own block.
 * Returns null on an empty side; reports the detected line ending so callers
 * can re-terminate.
 */
export function splitLeafForPaste(
	leaf: CstNode,
	offset: number
): { leadingNode: CstNode | null; trailingNode: CstNode | null; lineEnding: '\n' | '\r\n' } {
	const lineEnding: '\n' | '\r\n' = leaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const display = trimTrailingLineEnding(leaf.raw);
	const leadingText = display.slice(0, offset);
	const trailingText = display.slice(offset).replace(/^[ \t]/, '');

	const leadingNode = leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding) : null;
	const trailingNode = trailingText.length > 0 ? parseFirstBlock(trailingText + lineEnding) : null;

	return { leadingNode, trailingNode, lineEnding };
}
