/**
 * Unwrapping a list's first item, and merging a later item into the deepest text leaf of the one
 * before it. Both keep each block's absolute indent and the ordered-marker sequence.
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { Reading } from '../../schema/reading';
import { metadataOf } from '../../core/nodes';
import { firstDisplayLine, ownTrailingLineEnding, trailingLineEnding } from '../../core/lines';
import { canInterruptParagraph } from '../../core/parsers/list';
import { joinIntoLeaf } from '../node-ops';
import type { SharingState } from '../sharing';
import { cloneNode } from '../clone';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import { walkToDeepestMergeLeaf } from '../../schema/merge-rules';
import { orderedBaseOf, renumberOrderedList } from './ordered-markers';
import { itemPiecesInOrder, type ItemPiece } from './item-partition';
import { assembleListHalf } from './list-builders';
import { keepingListOrder } from '../../invariants/list-move-keeps-order';
import { ensureUnsharedChild, ensureUnsharedNode } from '../unshare';
import { pushChild } from '../children';

/**
 * Unwrap a list's first item without mutating the input: its children in the order they read, then
 * the rest of the list, which joins the sublist items when they come last.
 */
export function unwrapFirstItemFromList(list: NodeView): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

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

	return keepingListOrder(
		() => [list],
		() => unwrapInOrder(list, firstItem),
		(blocks) => blocks
	);
}

function unwrapInOrder(list: NodeView, firstItem: NodeView): CstNode[] {
	const parentOrdered = metadataOf(list, 'list')?.ordered ?? false;
	const pieces = itemPiecesInOrder(firstItem.children!, parentOrdered);
	// The list's later items join the sublist items when those come last.
	const last = pieces.at(-1);
	const tail: ItemPiece = last && 'items' in last ? last : { items: [], leadingTrivia: '' };
	for (const item of list.children!.slice(1)) tail.items.push(cloneNode(item));
	if (tail !== last && tail.items.length > 0) pieces.push(tail);

	// The list's starting number runs on across every list the unwrap leaves.
	let number = orderedBaseOf(firstItem);
	const blocks: CstNode[] = [];
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
	return blocks;
}

/** The line above a list the unwrap leaves: the one its sublist had, or under a paragraph a blank
 *  one when the list's first line can't interrupt the paragraph (CommonMark § 5.2). */
function lineAboveList(above: CstNode | undefined, list: CstNode, own: string): string {
	if (!above || own !== '' || above.kind !== 'paragraph') return above ? own : '';
	return canInterruptParagraph(firstDisplayLine(list.raw).text)
		? ''
		: ownTrailingLineEnding(above.raw);
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

	// The target item sits below the commit's chain, which rebuilds the list itself.
	rebuildAncestryRaw(list.children[targetPath[0]], targetPath.slice(1), reading.grammar);

	if (metadataOf(list, 'list')?.ordered) {
		// The merge only removes a non-first item, so children[0] keeps the list's starting number;
		// renumber from 1 to continue it rather than resetting the sequence.
		renumberOrderedList(list, 1, sharing);
	}

	return { mergePoint: { targetPath, offset: joined.joinOffset } };
}

/** The node at `path` below `root`, re-read through the tree. */
function nodeAt(root: CstNode, path: readonly number[]): CstNode {
	let node = root;
	for (const index of path) node = node.children![index];
	return node;
}
