/**
 * Structural list-item reshaping for U1 (unwrap a list's first item) and M1 (merge a
 * non-first item into the deepest text leaf of the preceding item). Both preserve absolute
 * indent and keep ordered-marker sequences intact.
 */

import type { CstNode, ListMetadata } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { PresentationMode } from '../../presentation-mode';
import type { InlineResolverRef } from '../../schema/inline-construct-policy';
import { metadataOf } from '../../core/nodes';
import { trailingLineEnding } from '../../core/lines';
import { cleanJoinedRaw } from '../node-ops';
import type { SharingState } from '../sharing';
import { cloneMetadata, cloneNode } from '../clone';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import { rebuildListRaw, rebuildListItemRaw } from '../../schema/container-rebuilders';
import { walkToDeepestMergeLeaf } from '../../schema/merge-rules';
import { renumberOrderedList } from './ordered-markers';
import { ensureUnsharedChild, ensureUnsharedNode, ensureUnsharedPath } from '../unshare';
import { assignIds } from '../../block-id';
import { pushChild } from '../children';

/**
 * Unwrap a list's first item (Rule U1) without mutating the input. Output order: lifted
 * non-list children and mismatched-type sub-lists first, then the shrunk parent list with
 * matching-type sub-list items prepended and ordered markers renumbered.
 */
export function unwrapFirstItemFromList(list: NodeView): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	const clonedList: CstNode = cloneNode(list);
	const parentOrdered = metadataOf(clonedList, 'list')?.ordered ?? false;

	const firstItem = clonedList.children![0];
	if (!firstItem.children || firstItem.children.length === 0) {
		// Empty item: nothing to lift, so return the shrunk list.
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
			? (cloneMetadata(clonedList.metadata) as ListMetadata)
			: { ordered: parentOrdered },
		children: remainingItems,
		childIds: assignIds(remainingItems),
		innerPrefix: clonedList.innerPrefix ?? '',
		innerSuffix: clonedList.innerSuffix ?? ''
	};

	// Preserve the original list's starting number: seed item 0, then continue from item 1.
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

/** M1's target-finder; null when no prose leaf is reachable. */
function findDeepestVisibleTextTarget(list: CstNode, targetItemIndex: number): number[] | null {
	if (!list.children || targetItemIndex < 0 || targetItemIndex >= list.children.length) {
		return null;
	}
	const startItem = list.children[targetItemIndex];
	const result = walkToDeepestMergeLeaf(startItem, [targetItemIndex]);
	return result ? result.path : null;
}

/**
 * Relocate the merged-away item's remaining children by "preserve absolute indent":
 * nested-list items promote to the depth-1 sibling container when the merge target sits
 * deeper, everything else absorbs into the target item. Children are MOVED into the live
 * tree and unshared individually, so the snapshot's view of the deleted item stays intact
 * (G1.9).
 */
function relocateRemainingChildren(
	list: CstNode,
	targetPath: number[],
	targetItem: CstNode,
	currentItem: CstNode,
	lineEnding: string,
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
			// A trailing paragraph keeps its blank-line separator, or the two lazy-continue
			// into one on reload. Other leaves start fresh and need none.
			child.leadingTrivia = child.kind === 'paragraph' ? lineEnding : '';
			// discovered-descendant mutation, see node-ops.ts header
			pushChild(targetItem, child);
		}
	}
}

/**
 * Merge the list item at `currentIndex` into the deepest text-bearing leaf of the
 * preceding item, mutating `list` in place and returning the merge point for the caret.
 * `targetPath`'s trailing index is the LAST paragraph in the target item, not always 0.
 * Null when the previous item exposes only an opaque deepest leaf — that is a legitimate
 * outcome the caller falls back from, unlike a bad `currentIndex`, which throws.
 */
export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	sharing: SharingState | undefined,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): { mergePoint: { targetPath: number[]; offset: number } } | null {
	// Targeting may read `list.children`, but the final splice MUST land in `children`
	// (`node-ops.ts` header).
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

	// Before any capture: the walk below must see the owned copies, and the target
	// paragraph's raw is written in place.
	if (sharing) ensureUnsharedPath({ children: list.children }, targetPath, sharing);

	let targetItem: CstNode = list;
	for (let i = 0; i < targetPath.length - 1; i++) {
		targetItem = targetItem.children![targetPath[i]];
	}
	// A loose item's walker ends past 0, so reading children[0] would mutate the wrong
	// paragraph.
	const targetParagraphIndex = targetPath[targetPath.length - 1];
	const targetParagraph = targetItem.children?.[targetParagraphIndex];
	if (!targetParagraph || targetParagraph.kind !== 'paragraph') {
		throw new Error('mergeListItemIntoPrevious: target path does not end at a paragraph');
	}
	const targetOriginalText = (targetParagraph.raw ?? '').replace(/\r?\n$/, '');

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

	const lineEnding = trailingLineEnding(targetParagraph.raw ?? '');
	// Every destructive join crosses the seam cleaner, M1 included: a literal concatenation
	// surfaces the marker runs the join orphaned, which live paints for nobody.
	const joined = cleanJoinedRaw(
		{
			mergedRaw: targetOriginalText + currentFirstText,
			seam: targetOriginalText.length,
			start: { node: targetParagraph, offset: targetOriginalText.length },
			end: { node: currentFirstParagraph, offset: 0 },
			linkRef
		},
		presentationMode
	);
	// The caret rides the CLEANED seam: a run dropped on the target's side moves where the
	// two halves met.
	const mergeOffset = joined.seam;
	targetParagraph.raw = joined.raw + lineEnding;

	relocateRemainingChildren(list, targetPath, targetItem, currentItem, lineEnding, sharing);

	children.splice(currentIndex, 1);

	// So the post-splice reads below see the new shape; idempotent with the commit's
	// final publish.
	list.children = children;

	rebuildAncestryRaw(list, targetPath);

	if (metadataOf(list, 'list')?.ordered) {
		// M1 only removes a non-first item, so children[0] keeps the list's original base;
		// renumber from 1 to continue it rather than resetting the sequence.
		renumberOrderedList(list, 1, sharing);
		rebuildListRaw(list);
	}

	return { mergePoint: { targetPath, offset: mergeOffset } };
}
