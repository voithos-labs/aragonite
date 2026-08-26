/**
 * The promote/lift partition U1 and the empty-item exit share: a nested list whose `ordered`
 * matches the parent gives its items to the parent level, everything else lifts out as a
 * sibling block. Output is fully owned; the input is not mutated.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import { cloneNode } from '../clone';

export interface ItemPartition {
	promotedItems: CstNode[];
	liftedBlocks: CstNode[];
}

/** Split a dissolving item's `children` into what rejoins the parent list and what lifts. */
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
