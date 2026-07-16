/**
 * Structural list-item reshaping for U1 (unwrap the first item out of a list)
 * and M1 (merge a non-first item into the deepest text leaf of the preceding
 * item). Both handle matching-type vs mismatched-type nested lists, preserve
 * absolute indent, and keep ordered-marker sequences intact.
 */

import type { CstNode, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataOf } from '../../core/nodes';
import type { SharingState } from '../sharing';
import { cloneNode } from '../clone';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { rebuildListRaw, rebuildListItemRaw } from '../../schema/container-rebuilders';
import { walkToDeepestMergeLeaf } from '../../schema/merge-rules';
import { renumberOrderedList } from './ordered-markers';
import { ensureUnsharedChild, ensureUnsharedNode, ensureUnsharedPath } from '../unshare';
import { freshChildIds } from '../../block-id';
import { pushChild } from '../children';

/**
 * Compute the result of unwrapping a list's first item under Rule U1.
 * Output order for mixed-content first item: first paragraph, then other
 * non-list children, then mismatched-type sub-lists, then the shrunk
 * parent list (with matching-type sub-list items prepended and ordered
 * markers renumbered). Input is not mutated.
 */
export function unwrapFirstItemFromList(list: NodeView): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	const clonedList: CstNode = cloneNode(list);
	const parentOrdered = metadataOf(clonedList, 'list')?.ordered ?? false;

	const firstItem = clonedList.children![0];
	if (!firstItem.children || firstItem.children.length === 0) {
		// Degenerate: empty item. Nothing to lift — return the shrunk list.
		const rest = clonedList.children!.slice(1);
		if (rest.length === 0) return [];
		clonedList.children = rest;
		rebuildListRaw(clonedList);
		return [clonedList];
	}

	const liftedBlocks: CstNode[] = [];
	const promotedItems: CstNode[] = [];

	for (const child of firstItem.children) {
		if (child.kind === 'list') {
			const childOrdered = metadataOf(child, 'list')?.ordered ?? false;
			if (childOrdered === parentOrdered) {
				if (child.children) {
					for (const item of child.children) {
						item.leadingTrivia = '';
						promotedItems.push(item);
					}
				}
			} else {
				child.leadingTrivia = '';
				liftedBlocks.push(child);
			}
		} else {
			child.leadingTrivia = '';
			liftedBlocks.push(child);
		}
	}

	const restItems = clonedList.children!.slice(1);
	const remainingItems = [...promotedItems, ...restItems];

	if (remainingItems.length === 0) {
		return liftedBlocks;
	}

	remainingItems[0].leadingTrivia = '';

	const remainingList: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: clonedList.metadata
			? ({ ...clonedList.metadata } as ListMetadata)
			: { ordered: parentOrdered },
		children: remainingItems,
		childIds: freshChildIds(remainingItems),
		innerPrefix: clonedList.innerPrefix ?? '',
		innerSuffix: clonedList.innerSuffix ?? ''
	};

	// Preserve the original list's starting number: seed item 0, then
	// continue the sequence from item 1.
	if (parentOrdered) {
		const base = parseInt(metadataOf(firstItem, 'listItem').marker, 10) || 1;
		const firstMeta = metadataOf(remainingItems[0], 'listItem');
		firstMeta.marker = String(base) + firstMeta.marker.replace(/^\d+/, '');
		rebuildListItemRaw(remainingItems[0]);
		renumberOrderedList(remainingList, 1);
	}

	rebuildListRaw(remainingList);

	liftedBlocks.push(remainingList);
	return liftedBlocks;
}

/**
 * M1's target-finder: descend the previous item's subtree last-child-first
 * to the deepest visible prose leaf. Returns a uniform path from `list` down
 * to the target paragraph, or null when no prose leaf is reachable.
 */
function findDeepestVisibleTextTarget(list: CstNode, targetItemIndex: number): number[] | null {
	if (!list.children || targetItemIndex < 0 || targetItemIndex >= list.children.length) {
		return null;
	}
	const startItem = list.children[targetItemIndex];
	const result = walkToDeepestMergeLeaf(startItem, [targetItemIndex]);
	return result ? result.path : null;
}

/**
 * Relocate the merged-away item's remaining children by "preserve absolute
 * indent": nested-list items promote to the depth-1 sibling container when
 * the merge target sits deeper (targetPath length ≥ 4); everything else
 * absorbs into the target item. Children are MOVED into the live tree and
 * unshared individually so the snapshot's view of the deleted item stays
 * intact (G1.9).
 */
function relocateRemainingChildren(
	list: CstNode,
	targetPath: number[],
	targetItem: CstNode,
	currentItem: CstNode,
	sharing?: SharingState
): void {
	const remainingChildren = currentItem
		.children!.slice(1)
		.map((c) => (sharing ? ensureUnsharedNode(c, sharing) : c));

	for (const child of remainingChildren) {
		if (child.kind === 'list' && child.children) {
			if (targetPath.length >= 4) {
				const depthOneParent = list.children![targetPath[0]];
				if (depthOneParent.children) {
					let depthOneIdx = -1;
					for (let i = 0; i < depthOneParent.children.length; i++) {
						if (depthOneParent.children[i].kind === 'list') depthOneIdx = i;
					}
					const depthOneList =
						depthOneIdx === -1
							? undefined
							: sharing
								? ensureUnsharedChild(depthOneParent, depthOneIdx, sharing)
								: depthOneParent.children[depthOneIdx];
					if (depthOneList && depthOneList.children) {
						for (let i = 0; i < child.children.length; i++) {
							const item = sharing ? ensureUnsharedChild(child, i, sharing) : child.children[i];
							item.leadingTrivia = '';
							// discovered-descendant mutation, see node-ops.ts header
							pushChild(depthOneList, item);
						}
						rebuildListRaw(depthOneList);
						continue;
					}
				}
			}
			// discovered-descendant mutation, see node-ops.ts header
			pushChild(targetItem, child);
		} else {
			child.leadingTrivia = '';
			// discovered-descendant mutation, see node-ops.ts header
			pushChild(targetItem, child);
		}
	}
}

/**
 * Merge the list item at `currentIndex` into the deepest text-bearing leaf
 * reachable by walking the preceding item's subtree last-child-first.
 * Mutates `list` in place.
 *
 * Child placement follows "preserve absolute indent": remaining children of
 * the current item are placed at their original absolute list-nesting depth
 * along the target's ancestry chain.
 *
 * Returns the merge point so the caller can position the cursor:
 *   targetPath: uniform path from `list` down to the target paragraph leaf
 *               (trailing index is the LAST paragraph within the target
 *               listItem — not always 0 for loose items).
 *   offset:     position within the target paragraph, before appended content.
 *
 * Returns null when the previous item exposes no text-bearing leaf (its deepest
 * leaf is opaque — a fenced code block, a collapsed container's chrome). The
 * caller falls back to a focus move; a null return is not a caller-contract
 * violation, so it is reported rather than thrown (unlike a bad `currentIndex`).
 */
export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	sharing?: SharingState
): { mergePoint: { targetPath: number[]; offset: number } } | null {
	// Reads from list.children are allowed during targeting, but the final
	// splice MUST land in `children`, not `list.children`. See node-ops.ts
	// header for the project-wide rule.
	if (
		list.kind !== 'list' ||
		!list.children ||
		currentIndex <= 0 ||
		currentIndex >= children.length
	) {
		throw new Error(`mergeListItemIntoPrevious: invalid currentIndex ${currentIndex}`);
	}

	const previousIndex = currentIndex - 1;
	const targetPath = findDeepestVisibleTextTarget(list, previousIndex);
	if (!targetPath) return null;

	// Own the deep-leaf spine before any capture — the walk below must see the
	// owned copies, and the target paragraph's raw is written in place.
	if (sharing) ensureUnsharedPath({ children: list.children }, targetPath, sharing);

	// Walk down to the listItem containing the target paragraph.
	let targetItem: CstNode = list;
	for (let i = 0; i < targetPath.length - 1; i++) {
		targetItem = targetItem.children![targetPath[i]];
	}
	// For loose items (children: [para "a", para "b"]) the walker ends at 1,
	// not 0 — reading children[0] would silently mutate the wrong paragraph.
	const targetParagraphIndex = targetPath[targetPath.length - 1];
	const targetParagraph = targetItem.children?.[targetParagraphIndex];
	if (!targetParagraph || targetParagraph.kind !== 'paragraph') {
		throw new Error('mergeListItemIntoPrevious: target path does not end at a paragraph');
	}
	const targetOriginalText = (targetParagraph.raw ?? '').replace(/\r?\n$/, '');
	const mergeOffset = targetOriginalText.length;

	const currentItem = children[currentIndex];
	if (
		!currentItem.children ||
		currentItem.children.length === 0 ||
		currentItem.children[0].kind !== 'paragraph'
	) {
		throw new Error('mergeListItemIntoPrevious: current item does not start with a paragraph');
	}

	const currentFirstParagraph = currentItem.children[0];
	const currentFirstText = (currentFirstParagraph.raw ?? '').replace(/\r?\n$/, '');

	const lineEnding = (targetParagraph.raw ?? '').endsWith('\r\n') ? '\r\n' : '\n';
	targetParagraph.raw = targetOriginalText + currentFirstText + lineEnding;

	relocateRemainingChildren(list, targetPath, targetItem, currentItem, sharing);

	children.splice(currentIndex, 1);

	// Sync list.children so post-splice reads (rebuildAncestryRaw,
	// renumberOrderedList, rebuildListRaw) see the new shape. Idempotent
	// with commitContainerStructural's final publish.
	list.children = children;

	rebuildAncestryRaw(list, targetPath);

	if (metadataOf(list, 'list')?.ordered) {
		// M1 only ever removes a non-first item, so children[0] keeps the
		// list's original base — renumber from 1 to continue from it rather
		// than resetting the sequence to 1 (fromIndex=0).
		renumberOrderedList(list, 1, sharing);
		rebuildListRaw(list);
	}

	return { mergePoint: { targetPath, offset: mergeOffset } };
}
