/** Constructors for list and listItem CST nodes. */

import type { CstNode, ListItemMetadata, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '../../core/lines';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { cloneMetadata, cloneNode } from '../clone';
import { parseCutResidue, parseFirstBlock } from '../parse-block';
import { renumberOrderedListFrom } from './ordered-markers';
import { assignIds } from '../../block-id';
import { parse } from '../../core/parser';
import { emptyParagraph } from '../node-primitives';
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
	renumberOrderedListFrom(half, startNumber);
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
 * A bare list shell with empty raw. Unlike `assembleListHalf` it neither renumbers nor
 * rebuilds raw; a live-tree caller owns that and must route it through `sharing` so the
 * moved items are copied before being written (`unshare.ts`).
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
 * Slice a leaf's raw at `offset` for a paste-style split, re-parsing each half; the trailing
 * half is every block its lines make. One leading space or tab is trimmed from it, which would
 * otherwise double the space after the new marker. `raw` overrides the leaf's own bytes, which
 * a paste that ran a delete half first supplies.
 */
export function splitLeafForPaste(
	leaf: CstNode,
	offset: number,
	raw: string = leaf.raw,
	grammar: GrammarView
): { leadingNode: CstNode | null; trailingNodes: CstNode[]; lineEnding: '\n' | '\r\n' } {
	const lineEnding = trailingLineEnding(raw);
	const display = trimTrailingLineEnding(raw);
	// Off any scalar interior first: the halves become separate items, so a pair cut here is
	// unrecoverable bytes rather than a recoverable edit.
	const cut = snapToScalarBoundary(display, offset);
	const leadingText = display.slice(0, cut);
	const trailingText = display.slice(cut).replace(/^[ \t]/, '');

	const leadingNode =
		leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding, grammar) : null;
	// The line the cut ended is dropped: the trailing item's marker starts a line of its own.
	const trailingNodes = parseCutResidue(trailingText, lineEnding, grammar).blocks;

	return { leadingNode, trailingNodes, lineEnding };
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
	targetRaw: string | undefined,
	grammar: GrammarView
): { leadingItem: CstNode | null; trailingItem: CstNode | null } {
	if (!item.children) return { leadingItem: null, trailingItem: null };
	const targetLeaf = item.children[innerIndex];
	if (!targetLeaf) return { leadingItem: null, trailingItem: null };

	const { leadingNode, trailingNodes } = splitLeafForPaste(
		targetLeaf,
		offset,
		targetRaw ?? targetLeaf.raw,
		grammar
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
			trailingChildren.length > 0 ? trailingItemFor(item, trailingChildren, grammar) : null
	};
}

/**
 * The item holding the text after a split. Its first block goes on the marker line unless the
 * reload reads that line otherwise (indented code there reads as a wider marker); then it opens
 * on the line after an empty marker, which is how the parser reads an item starting that way.
 */
function trailingItemFor(template: CstNode, children: CstNode[], grammar: GrammarView): CstNode {
	const onMarkerLine = buildListItemWithContent(template, children);
	if (readsBackAsBuilt(onMarkerLine, grammar)) return onMarkerLine;
	const lineEnding = trailingLineEnding(children[0].raw);
	const belowMarker = buildListItemWithContent(template, [
		emptyParagraph('', lineEnding),
		...children
	]);
	return readsBackAsBuilt(belowMarker, grammar) ? belowMarker : onMarkerLine;
}

/** Whether `item`'s bytes, read alone, give back one item holding the same blocks. */
function readsBackAsBuilt(item: CstNode, grammar: GrammarView): boolean {
	const blocks = parse(item.raw, { grammar, scope: 'fragment' }).children;
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
