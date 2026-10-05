/**
 * How a dissolving item's children leave it: a nested list whose `ordered` matches the parent gives
 * its items to the parent level, everything else lifts out as a sibling block. Output is fully
 * owned; the input is not mutated.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { cloneNode } from '../clone';

export interface ItemPartition {
	promotedItems: CstNode[];
	liftedBlocks: CstNode[];
}

/** Split an exiting item's `children` into what rejoins the parent list and what lifts. */
export function partitionItemChildren(
	children: readonly NodeView[],
	parentOrdered: boolean
): ItemPartition {
	const promotedItems: CstNode[] = [];
	const liftedBlocks: CstNode[] = [];

	for (const child of children) {
		if (promotesToParentLevel(child, parentOrdered)) {
			for (const item of child.children!) promotedItems.push(adopt(item));
			continue;
		}
		liftedBlocks.push(adopt(child));
	}

	return { promotedItems, liftedBlocks };
}

/** One stretch of an unwrapped item's children: a block that lifts out as it is, or the items of
 *  back-to-back sublists that rejoin the parent level, with the blank line above the first one. */
export type ItemPiece = { block: CstNode } | { items: CstNode[]; leadingTrivia: string };

/** An unwrapped item's children in the order they read; each lifted block but the first keeps the
 *  blank line above it, so two paragraphs never join. */
export function itemPiecesInOrder(
	children: readonly NodeView[],
	parentOrdered: boolean
): ItemPiece[] {
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

// A sublist with no items has nothing to give, and its bytes would vanish with it, so it lifts.
function promotesToParentLevel(child: NodeView, parentOrdered: boolean): boolean {
	if (child.kind !== 'list' || !child.children?.length) return false;
	return (metadataOf(child, 'list')?.ordered ?? false) === parentOrdered;
}

/** Both dispositions start a fresh line at their new level. */
function adopt(node: NodeView): CstNode {
	const owned = cloneNode(node);
	owned.leadingTrivia = '';
	return owned;
}
