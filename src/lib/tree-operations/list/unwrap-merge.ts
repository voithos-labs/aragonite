/**
 * Unwrapping a list's first item, and merging a later item into the deepest text leaf of the one
 * before it. Both keep each block's absolute indent and the ordered-marker sequence.
 */

import type { CstNode, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { Reading } from '../../schema/reading';
import { metadataOf } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { joinIntoLeaf } from '../node-ops';
import { createSharingState, type SharingState } from '../sharing';
import { cloneMetadata, cloneNode } from '../clone';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import { walkToDeepestMergeLeaf } from '../../schema/merge-rules';
import { orderedBaseOf, renumberOrderedList, renumberOrderedListFrom } from './ordered-markers';
import { partitionItemChildren } from './item-partition';
import { ensureUnsharedChild, ensureUnsharedNode } from '../unshare';
import { assignIds } from '../../block-id';
import { pushChild } from '../children';

/**
 * Unwrap a list's first item without mutating the input: the item's other children lifted out,
 * then the rest of the list with the promoted sub-list items first.
 */
export function unwrapFirstItemFromList(list: NodeView): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	const parentOrdered = metadataOf(list, 'list')?.ordered ?? false;

	const firstItem = list.children[0];
	if (!firstItem.children || firstItem.children.length === 0) {
		const clonedList: CstNode = cloneNode(list);
		const rest = clonedList.children!.slice(1);
		if (rest.length === 0) return [];
		clonedList.children = rest;
		// childIds pairs by index, so it slices with the children or every survivor
		// inherits its predecessor's id.
		clonedList.childIds = clonedList.childIds?.slice(1);
		rebuildListRaw(clonedList);
		return [clonedList];
	}

	const { promotedItems, liftedBlocks } = partitionItemChildren(firstItem.children, parentOrdered);

	const restItems = list.children.slice(1).map(cloneNode);
	const remainingItems = [...promotedItems, ...restItems];

	if (remainingItems.length === 0) {
		return liftedBlocks;
	}

	remainingItems[0].leadingTrivia = '';

	const remainingList: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: list.metadata
			? (cloneMetadata(list.metadata) as ListMetadata)
			: { ordered: parentOrdered },
		children: remainingItems,
		childIds: assignIds(remainingItems),
		innerPrefix: list.innerPrefix ?? '',
		innerSuffix: list.innerSuffix ?? ''
	};

	// Preserve the original list's starting number. The items are clones no undo entry holds, so a
	// fresh sharing state copies none of them.
	renumberOrderedListFrom(remainingList, orderedBaseOf(firstItem), createSharingState());

	rebuildListRaw(remainingList);

	liftedBlocks.push(remainingList);
	return liftedBlocks;
}

/** The merge target's path; null when no prose leaf is reachable. */
function findDeepestVisibleTextTarget(list: CstNode, targetItemIndex: number): number[] | null {
	if (!list.children || targetItemIndex < 0 || targetItemIndex >= list.children.length) {
		return null;
	}
	const startItem = list.children[targetItemIndex];
	const result = walkToDeepestMergeLeaf(startItem, [targetItemIndex]);
	return result ? result.path : null;
}

/**
 * The last list child of the merge target's top-level item, where a deep target's nested items
 * go to keep their indent. Unshares the list it resolves.
 */
function depthOneListFor(
	list: CstNode,
	targetPath: number[],
	sharing: SharingState
): CstNode | null {
	if (targetPath.length < 4) return null;
	const depthOneParent = list.children![targetPath[0]];
	if (!depthOneParent.children) return null;
	const idx = depthOneParent.children.findLastIndex((c) => c.kind === 'list');
	if (idx === -1) return null;
	const depthOneList = ensureUnsharedChild(depthOneParent, idx, sharing);
	return depthOneList.children ? depthOneList : null;
}

/**
 * Move the merged item's remaining children to where they keep their absolute indent, copying each
 * first so the undo entry's deleted item stays intact.
 */
function relocateRemainingChildren(
	list: CstNode,
	targetPath: number[],
	targetItem: CstNode,
	currentItem: CstNode,
	sharing: SharingState
): void {
	const remainingChildren = currentItem
		.children!.slice(1)
		.map((c) => ensureUnsharedNode(c, sharing));

	for (const child of remainingChildren) {
		if (child.kind === 'list' && child.children) {
			const depthOneList = depthOneListFor(list, targetPath, sharing);
			if (depthOneList) {
				for (let i = 0; i < child.children.length; i++) {
					const item = ensureUnsharedChild(child, i, sharing);
					item.leadingTrivia = '';
					// An in-place write on a descendant found by walking, see the `node-primitives.ts` header.
					pushChild(depthOneList, item);
				}
				rebuildListRaw(depthOneList);
				continue;
			}
			// An in-place write on a descendant found by walking, see the `node-primitives.ts` header.
			pushChild(targetItem, child);
		} else {
			// The child keeps its own blank line: the joined text above it ends the way the text it
			// followed did. An in-place write on a descendant, see the `node-primitives.ts` header.
			pushChild(targetItem, child);
		}
	}
}

/** Merge the item at `currentIndex` into the preceding item's last prose leaf, mutating `list`;
 *  null when there is nothing to join, and the caller falls back. A bad `currentIndex` throws. */
export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	sharing: SharingState,
	reading: Reading
): { mergePoint: { targetPath: number[]; offset: number } } | null {
	// Targeting may read `list.children`, but the final splice must land in `children`
	// (`node-primitives.ts` header).
	if (
		list.kind !== 'list' ||
		!list.children ||
		currentIndex <= 0 ||
		currentIndex >= children.length
	) {
		throw new Error(`mergeListItemIntoPrevious: invalid currentIndex ${currentIndex}`);
	}

	const targetPath = findDeepestVisibleTextTarget(list, currentIndex - 1);
	if (!targetPath) return null;
	const currentItem = children[currentIndex];
	const absorbed = currentItem.children?.[0];
	if (absorbed?.kind !== 'paragraph') return null;

	// The target has the current item below it, so it closes its line with the document's ending.
	const lineEnding = trailingLineEnding(nodeAt(list, targetPath).raw, '\n');
	const body = { children: list.children, owner: list, lineEnding };
	const joined = joinIntoLeaf(body, targetPath, absorbed, reading, sharing);
	if (!joined) return null;

	const targetItem = nodeAt(list, targetPath.slice(0, -1));
	relocateRemainingChildren(list, targetPath, targetItem, currentItem, sharing);

	children.splice(currentIndex, 1);

	// So the post-splice reads below see the new shape; idempotent with the commit's
	// final write to state.
	list.children = children;

	rebuildAncestryRaw(list, targetPath, reading.grammar);

	if (metadataOf(list, 'list')?.ordered) {
		// The merge only removes a non-first item, so children[0] keeps the list's starting number;
		// renumber from 1 to continue it rather than resetting the sequence.
		renumberOrderedList(list, 1, sharing);
		rebuildListRaw(list);
	}

	return { mergePoint: { targetPath, offset: joined.joinOffset } };
}

/** The node at `path` below `root`, re-read through the tree. */
function nodeAt(root: CstNode, path: readonly number[]): CstNode {
	let node = root;
	for (const index of path) node = node.children![index];
	return node;
}
