/** Constructors for list and listItem CST nodes. */

import {
	metadataOf,
	type CstNode,
	type ListItemMetadata,
	type ListMetadata
} from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trailingLineEnding, type LineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { readItemShape } from '../../core/parsers/list';
import { cloneMetadata, cloneNode } from '../clone';
import { parseCutResidue, parseFirstBlock } from '../parse-block';
import { cutKeepingStructure } from '../structural-suffix';
import { renumberOrderedListFrom } from './ordered-markers';
import { createSharingState } from '../sharing';
import { assignIds } from '../../block-id';
import { fragmentReaderAt, markerLineWidening, type FragmentReader } from './task-paragraph';
import type { GrammarView } from '../../schema/block-openers';
import { adoptOwnReading } from '../../schema/container-raw';
import { emptyParagraph } from '../node-primitives';

// ── List / item construction ─────────────────────────────────────────────────

/**
 * A list node carrying `items`, which keep their own bytes, mirroring `template`'s metadata and
 * affixes and renumbering ordered markers from `startNumber`. Items are mutated in place.
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
	// The caller owns the items, so a fresh sharing state copies none of them.
	renumberOrderedListFrom(half, startNumber, createSharingState());
	rebuildListRaw(half);
	return half;
}

/** A listItem mirroring `template`'s metadata, affixes and bytes, so lines it keeps keep their
 *  spelling, then holding what those bytes read as. Clone any `children` the tree still holds. */
export function buildListItemWithContent(
	template: NodeView,
	children: CstNode[],
	grammar: GrammarView
): CstNode {
	const metadata = template.metadata
		? (cloneMetadata(template.metadata) as ListItemMetadata)
		: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null };
	return mintListItem(metadata, template, children, grammar);
}

/** A listItem from explicit metadata with empty affixes, starting from the bytes of `source` when
 *  `children` came out of it, and then holding what those bytes read as. */
export function buildListItem(
	metadata: ListItemMetadata,
	children: CstNode[],
	grammar: GrammarView,
	source?: NodeView
): CstNode {
	const affixes = { raw: source?.raw ?? '', innerPrefix: '', innerSuffix: '' };
	return mintListItem(metadata, affixes, children, grammar);
}

// Affixes are set before the rebuild, which derives the item's raw from them and `source.raw`.
function mintListItem(
	metadata: ListItemMetadata,
	source: Pick<NodeView, 'raw' | 'innerPrefix' | 'innerSuffix'>,
	children: CstNode[],
	grammar: GrammarView
): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: source.raw,
		metadata,
		innerPrefix: source.innerPrefix ?? '',
		children,
		childIds: assignIds(children),
		innerSuffix: source.innerSuffix ?? ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	// Bytes that read as no item are written where they read as this one (`docs/design/editor.md`
	// § 9): under the marker their first line widens, else below an empty marker line.
	if (adoptOwnReading(item, grammar)) return item;
	if (takeWidenedMarker(item, grammar) && adoptOwnReading(item, grammar)) return item;
	openBelowMarker(item);
	adoptOwnReading(item, grammar);
	return item;
}

/** `item` takes the marker its first line reads as, the spaces it widens over moving off the
 *  first block, and writes its other lines at that marker's content column. */
function takeWidenedMarker(item: CstNode, grammar: GrammarView): boolean {
	const widened = markerLineWidening(item, grammar);
	if (!widened) return false;
	const first = item.children![0];
	item.metadata = widened.metadata;
	first.raw = first.raw.slice(widened.taken);
	rewriteFromOpener(item);
	return true;
}

/** `item` with an empty first line, its blocks below it: a first line no marker holds (a line of
 *  dashes reads as a divider) reads as the item's own there. */
function openBelowMarker(item: CstNode): void {
	const children = item.children!;
	children.unshift(emptyParagraph('', trailingLineEnding(children[0]?.raw ?? '', '\n')));
	item.childIds = assignIds(children);
	rewriteFromOpener(item);
}

/** Rebuilds `item` from its opener line alone, so no line below keeps a column it was written at. */
function rewriteFromOpener(item: CstNode): void {
	const { marker, taskMarker } = metadataOf(item, 'listItem');
	item.raw = (readItemShape(item.raw)?.indent ?? '') + marker + (taskMarker ?? '');
	rebuildListItemRaw(item);
}

/**
 * A bare list shell that neither renumbers nor rebuilds raw; a live-tree caller does both through
 * `sharing`, so the moved items are copied before being written.
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

/** Split a leaf's raw at `offset` for a paste, each half read as its landing slot reads it and
 *  every byte kept. */
export function splitLeafForPaste(
	leaf: CstNode,
	offset: number,
	ending: LineEnding,
	raw: string = leaf.raw,
	read: { leading: FragmentReader; trailing: FragmentReader }
): { leadingNode: CstNode | null; trailingNodes: CstNode[]; lineEnding: LineEnding } {
	const lineEnding = trailingLineEnding(raw, ending);
	const { head: leadingText, rest } = cutKeepingStructure({ ...leaf, raw }, offset);
	const leadingNode =
		leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding, read.leading) : null;
	// The line the cut ended is dropped: the trailing item's marker starts a line of its own.
	const trailingNodes = parseCutResidue(rest, lineEnding, read.trailing).blocks;

	return { leadingNode, trailingNodes, lineEnding };
}

/**
 * The items replacing `item` when a paste splits it at `(innerIndex, offset)`; either is null when
 * the caret sits flush against a boundary.
 */
export function buildSplitItems(
	item: CstNode,
	innerIndex: number,
	offset: number,
	ending: LineEnding,
	targetRaw: string | undefined,
	grammar: GrammarView
): { leadingItem: CstNode | null; trailingItem: CstNode | null } {
	if (!item.children) return { leadingItem: null, trailingItem: null };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { leadingItem: null, trailingItem: null };

	// Both halves keep the item's marker, so the leading one stays at `innerIndex` under it and
	// the trailing one opens its own copy of the item.
	const { leadingNode, trailingNodes } = splitLeafForPaste(
		targetLeaf,
		offset,
		ending,
		targetRaw ?? targetLeaf.raw,
		{
			leading: fragmentReaderAt(item, innerIndex, grammar),
			trailing: fragmentReaderAt(item, 0, grammar)
		}
	);

	const leadingChildren: CstNode[] = item.children.slice(0, innerIndex).map(cloneNode);
	if (leadingNode) leadingChildren.push(leadingNode);

	const trailingChildren: CstNode[] = [];
	for (const node of trailingNodes) trailingChildren.push(node);
	for (const c of item.children.slice(innerIndex + 1)) trailingChildren.push(cloneNode(c));
	if (trailingChildren[0]) trailingChildren[0].leadingTrivia = '';

	return {
		leadingItem:
			leadingChildren.length > 0 ? buildListItemWithContent(item, leadingChildren, grammar) : null,
		trailingItem:
			trailingChildren.length > 0 ? buildListItemWithContent(item, trailingChildren, grammar) : null
	};
}
