/** Constructors for list and listItem CST nodes. */

import type { CstNode, ListItemMetadata, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trailingLineEnding, type LineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { cloneMetadata, cloneNode } from '../clone';
import { parseCutResidue, parseFirstBlock } from '../parse-block';
import { cutKeepingStructure } from '../structural-suffix';
import { renumberOrderedListFrom } from './ordered-markers';
import { createSharingState } from '../sharing';
import { assignIds } from '../../block-id';
import { readBlocks } from '../../core/parser';
import { emptyParagraph } from '../node-primitives';
import { fragmentReaderAt, type FragmentReader } from './task-paragraph';
import type { GrammarView } from '../../schema/block-openers';

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
	// The caller owns the items, so a fresh sharing state copies none of them.
	renumberOrderedListFrom(half, startNumber, createSharingState());
	rebuildListRaw(half);
	return half;
}

/**
 * A listItem mirroring `template`'s metadata/affixes. `children` are placed verbatim, so
 * clone them before passing if they are still referenced from the source tree.
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

/**
 * Split a leaf's raw at `offset` for a paste, each half read as its landing slot reads it, the
 * trailing half losing one leading space or tab so the new marker's space isn't doubled.
 */
export function splitLeafForPaste(
	leaf: CstNode,
	offset: number,
	ending: LineEnding,
	raw: string = leaf.raw,
	read: { leading: FragmentReader; trailing: FragmentReader }
): { leadingNode: CstNode | null; trailingNodes: CstNode[]; lineEnding: LineEnding } {
	const lineEnding = trailingLineEnding(raw, ending);
	const { head: leadingText, rest } = cutKeepingStructure({ ...leaf, raw }, offset);
	const trailingText = rest.replace(/^[ \t]/, '');

	const leadingNode =
		leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding, read.leading) : null;
	// The line the cut ended is dropped: the trailing item's marker starts a line of its own.
	const trailingNodes = parseCutResidue(trailingText, lineEnding, read.trailing).blocks;

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
	const { leadingNode, trailingNodes, lineEnding } = splitLeafForPaste(
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
			leadingChildren.length > 0 ? buildListItemWithContent(item, leadingChildren) : null,
		trailingItem:
			trailingChildren.length > 0
				? trailingItemFor(item, trailingChildren, lineEnding, grammar)
				: null
	};
}

/**
 * The item holding the text after a split, its first block on the marker line unless the reload
 * reads that line otherwise (indented code reads as a wider marker), then below an empty marker.
 */
function trailingItemFor(
	template: CstNode,
	children: CstNode[],
	lineEnding: LineEnding,
	grammar: GrammarView
): CstNode {
	const onMarkerLine = buildListItemWithContent(template, children);
	if (readsBackAsBuilt(onMarkerLine, grammar)) return onMarkerLine;
	const belowMarker = buildListItemWithContent(template, [
		emptyParagraph('', lineEnding),
		...children
	]);
	return readsBackAsBuilt(belowMarker, grammar) ? belowMarker : onMarkerLine;
}

/** Whether `item`'s bytes, read alone, give back one item holding the same blocks. */
function readsBackAsBuilt(item: CstNode, grammar: GrammarView): boolean {
	const blocks = readBlocks(item.raw, { grammar, scope: 'fragment' }).children;
	const list = blocks.length === 1 && blocks[0].kind === 'list' ? blocks[0] : null;
	const read = list?.children?.length === 1 ? list.children[0] : null;
	const built = item.children ?? [];
	return (
		read?.children?.length === built.length &&
		read.children.every(
			(child, i) =>
				child.kind === built[i].kind &&
				child.raw === built[i].raw &&
				child.leadingTrivia === built[i].leadingTrivia
		)
	);
}
