/**
 * How a dissolving list item's children leave it: in the order they read, a same-kind sublist's
 * items rejoining the list's level and every other block lifting out beside it. Output is fully
 * owned; the input is not mutated.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { firstDisplayLine, ownTrailingLineEnding } from '../../core/lines';
import { canInterruptParagraph } from '../../core/parsers/list';
import { keepingListOrder } from '../../invariants/list-move-keeps-order';
import { leafTexts } from '../../invariants/leaf-text';
import { cloneNode } from '../clone';
import { assembleListHalf } from './list-builders';
import { orderedBaseOf } from './ordered-markers';

export interface DissolvedItem {
	blocks: CstNode[];
	/** Where the item's own first block landed. */
	firstBlockIndex: number;
}

/** The blocks `list` becomes once item `itemIndex` dissolves, with `firstBlock` standing in for the
 *  item's first child; a dev build warns when the text no longer reads in the same order. */
export function dissolveItem(
	list: NodeView,
	itemIndex: number,
	firstBlock?: CstNode
): DissolvedItem {
	return keepingListOrder(
		() => leafTexts([list]),
		() => {
			const own = list.children![itemIndex].children ?? [];
			const children = firstBlock ? [firstBlock, ...own.slice(1)] : own;
			const parentOrdered = metadataOf(list, 'list')?.ordered ?? false;
			return assembleInOrder(list, itemIndex, itemPiecesInOrder(children, parentOrdered));
		},
		({ blocks }) => leafTexts(blocks)
	);
}

/** One stretch of a dissolving item's children: a block that lifts out as it is, or the items of
 *  back-to-back sublists that rejoin the parent level, with the blank line above the first one. */
type ItemPiece = { block: CstNode } | { items: CstNode[]; leadingTrivia: string };

/** Each lifted block but the first keeps the blank line above it, so two paragraphs never join. */
function itemPiecesInOrder(children: readonly NodeView[], parentOrdered: boolean): ItemPiece[] {
	const pieces: ItemPiece[] = [];
	children.forEach((child, i) => {
		if (!promotesToParentLevel(child, parentOrdered)) {
			pieces.push({ block: i === 0 ? adopt(child) : cloneNode(child) });
			return;
		}
		let run = pieces.at(-1);
		if (!run || !('items' in run)) {
			run = { items: [], leadingTrivia: child.leadingTrivia };
			pieces.push(run);
		}
		for (const item of child.children!) run.items.push(adopt(item));
	});
	return pieces;
}

function assembleInOrder(list: NodeView, itemIndex: number, pieces: ItemPiece[]): DissolvedItem {
	const items = list.children!;
	// The list's later items join the sublist items when those come last.
	const last = pieces.at(-1);
	const tail: ItemPiece = last && 'items' in last ? last : { items: [], leadingTrivia: '' };
	for (const item of items.slice(itemIndex + 1)) tail.items.push(cloneNode(item));
	if (tail !== last && tail.items.length > 0) pieces.push(tail);

	// The list's starting number runs on across every list the item leaves, never spending its slot.
	const base = orderedBaseOf(items[0]);
	const blocks: CstNode[] = [];
	if (itemIndex > 0)
		blocks.push(assembleListHalf(list, items.slice(0, itemIndex).map(cloneNode), base));
	const firstBlockIndex = blocks.length;
	let number = base + itemIndex;
	for (const piece of pieces) {
		if ('block' in piece) {
			blocks.push(piece.block);
			continue;
		}
		const half = assembleListHalf(list, piece.items, number);
		number += piece.items.length;
		half.leadingTrivia = lineAboveList(blocks.at(-1), half, piece.leadingTrivia);
		blocks.push(half);
	}
	return { blocks, firstBlockIndex };
}

/** The line above a list the item leaves: the one its sublist had, or under a paragraph a blank
 *  one when the list's first line can't interrupt the paragraph (CommonMark § 5.2). */
function lineAboveList(above: CstNode | undefined, list: CstNode, own: string): string {
	if (!above || own !== '' || above.kind !== 'paragraph') return above ? own : '';
	return canInterruptParagraph(firstDisplayLine(list.raw).text)
		? ''
		: ownTrailingLineEnding(above.raw);
}

// A sublist with no items has nothing to give, and its bytes would vanish with it, so it lifts.
function promotesToParentLevel(child: NodeView, parentOrdered: boolean): boolean {
	if (child.kind !== 'list' || !child.children?.length) return false;
	return (metadataOf(child, 'list')?.ordered ?? false) === parentOrdered;
}

/** The item's first block and every rejoining item start a fresh line at their new level. */
function adopt(node: NodeView): CstNode {
	const owned = cloneNode(node);
	owned.leadingTrivia = '';
	return owned;
}
