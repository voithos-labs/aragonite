/**
 * List-specific tree operations: first-item unwrap (Rule U1), non-first-item
 * merge (Rule M1), and ordered-list marker renumbering. Kind-agnostic
 * operations (split, merge, delete, update) live in `generic.ts`.
 */

import type { CstNode } from '../core/nodes';
import { cloneNode } from '../mutable-tree';
import { rebuildListRaw, rebuildListItemRaw } from '../container-raw';
import { walkToDeepestMergeLeaf } from '../merge-rules';
import { rebuildAncestryRaw } from './generic';

// ── Emptiness check ──

/**
 * A list item is "user-empty" when every leaf descendant's raw is blank.
 * Strictly stronger than "first child is an empty paragraph" — the shallow
 * check dropped trailing content (extra paragraphs, nested lists) when the
 * first paragraph happened to be empty. Used by both the Backspace path
 * (ListBlock.mergeWithPrevious) and the Enter path (ListItemBlock.splitBlock)
 * to guard the exit-list-via-empty-item branch.
 */
export function isItemUserEmpty(item: CstNode): boolean {
	if (!item.children || item.children.length === 0) return true;
	for (const child of item.children) {
		if (child.children && child.children.length > 0) {
			if (!isItemUserEmpty(child)) return false;
		} else if ((child.raw ?? '').trim() !== '') {
			return false;
		}
	}
	return true;
}

// ── Ordered-list numbering helpers ──

/**
 * Renumber an ordered list's items in place starting at `fromIndex`. Items
 * before `fromIndex` keep their markers; each item at or after gets the
 * next number in sequence, seeded from the prior item's current marker (or
 * from 1 when `fromIndex` is 0). No-op on unordered lists.
 *
 * Preserves each item's marker suffix (`. ` vs `) `) instead of rewriting
 * it, so mixed-suffix lists stay intact. Rebuilds each touched item's raw.
 *
 * Note: when `fromIndex` is 0 this resets the sequence to 1, not to the
 * list's original start number. Callers that need to preserve a non-1
 * base (e.g. `unwrapFirstItemFromList`) must seed the item at index 0
 * manually and then call this helper with `fromIndex=1`.
 */
export function renumberOrderedList(list: CstNode, fromIndex = 0): void {
	if (!list.children) return;
	if (!(list.metadata as { ordered?: boolean } | undefined)?.ordered) return;
	for (let j = fromIndex; j < list.children.length; j++) {
		const prevNum =
			j > 0 ? parseInt((list.children[j - 1].metadata as { marker: string }).marker, 10) || 0 : 0;
		const meta = list.children[j].metadata as { marker: string };
		const suffix = meta.marker.replace(/^\d+/, '');
		meta.marker = String(prevNum + 1) + suffix;
		rebuildListItemRaw(list.children[j]);
	}
}

/**
 * Rewrite `item`'s marker so its style matches `parentList` (ordered ↔
 * unordered). The new marker's suffix character is templated from a
 * sibling in `parentList` so `*`/`+`/`-` or `.`/`)` choices follow
 * whatever the destination list already uses. No-op when the item already
 * matches the parent list's ordering. The caller should renumber the
 * parent list afterward — this helper only touches marker style, not
 * sequence numbers.
 */
export function normalizeItemMarkerToList(item: CstNode, parentList: CstNode): void {
	const parentOrdered =
		(parentList.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	const meta = item.metadata as { marker: string };
	const itemOrdered = /^\d/.test(meta.marker);
	if (itemOrdered === parentOrdered) return;

	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? (siblings[0].metadata as { marker: string }).marker : undefined;

	if (parentOrdered) {
		// Item is unordered, parent is ordered. Template gives the numeric suffix.
		const suffix = templateMarker?.replace(/^\d+/, '') ?? '. ';
		meta.marker = '1' + suffix;
	} else {
		// Item is ordered, parent is unordered. Use the template marker verbatim.
		meta.marker = templateMarker ?? '- ';
	}
	rebuildListItemRaw(item);
}

// ── U1: unwrap first item from list ──

/**
 * Compute the result of unwrapping a list's first item under Rule U1.
 *
 * Output ordering (when the first item has mixed content):
 *   1. The item's first paragraph (always first)
 *   2. Any other non-listItem, non-list children of the item (e.g., extra
 *      paragraphs from a loose list item), in original order
 *   3. Any mismatched-type nested sub-lists, as separate top-level blocks
 *   4. The shrunk parent list (if non-empty). Matching-type nested sub-list
 *      items are prepended to the remaining parent list items and ordered
 *      markers are renumbered.
 *
 * Input is not mutated.
 */
export function unwrapFirstItemFromList(list: CstNode): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	// Deep clone to avoid mutating input — use cloneNode (not JSON round-trip)
	// to avoid carrying the inlineContent rendering cache.
	const clonedList: CstNode = cloneNode(list);
	const parentOrdered = (clonedList.metadata as { ordered: boolean } | undefined)?.ordered ?? false;

	const firstItem = clonedList.children![0];
	if (!firstItem.children || firstItem.children.length === 0) {
		// Degenerate: empty item. Treat as "nothing to lift" — return the shrunk list.
		const rest = clonedList.children!.slice(1);
		if (rest.length === 0) return [];
		clonedList.children = rest;
		rebuildListRaw(clonedList);
		return [clonedList];
	}

	const liftedBlocks: CstNode[] = [];
	const promotedItems: CstNode[] = []; // matching-type nested items to prepend to remaining list

	// Walk the first item's children. Classify each:
	//   - paragraph / heading / other non-listItem leaf → lifted block (in order)
	//   - list of matching type → items promoted to prepend to remaining parent list
	//   - list of mismatched type → emitted as separate top-level block
	//   - other containers → lifted as-is (rare)
	for (const child of firstItem.children) {
		if (child.kind === 'list') {
			const childOrdered = (child.metadata as { ordered: boolean } | undefined)?.ordered ?? false;
			if (childOrdered === parentOrdered) {
				// Matching type — promote its items to prepend to the remaining list
				if (child.children) {
					for (const item of child.children) {
						// Reset leading trivia of promoted items
						item.leadingTrivia = '';
						promotedItems.push(item);
					}
				}
			} else {
				// Mismatched type — keep as a separate top-level list block
				child.leadingTrivia = '';
				liftedBlocks.push(child);
			}
		} else {
			// Non-list child — lift as a top-level block
			child.leadingTrivia = '';
			liftedBlocks.push(child);
		}
	}

	// Build the remaining parent list: [...promotedItems, ...restOfOriginalItems]
	const restItems = clonedList.children!.slice(1);
	const remainingItems = [...promotedItems, ...restItems];

	if (remainingItems.length === 0) {
		// Everything was lifted out — no remaining list.
		return liftedBlocks;
	}

	// Normalize leading trivia of the first remaining item
	remainingItems[0].leadingTrivia = '';

	const remainingList: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: clonedList.metadata ? { ...clonedList.metadata } : { ordered: parentOrdered },
		children: remainingItems,
		innerPrefix: clonedList.innerPrefix ?? '',
		innerSuffix: clonedList.innerSuffix ?? ''
	};

	// Renumber from the base of the original list, preserving its starting
	// number. Seed the first remaining item with the original base, then let
	// renumberOrderedList carry the sequence forward.
	if (parentOrdered) {
		const base = parseInt((firstItem.metadata as { marker: string }).marker, 10) || 1;
		const firstMeta = remainingItems[0].metadata as { marker: string };
		firstMeta.marker = String(base) + firstMeta.marker.replace(/^\d+/, '');
		rebuildListItemRaw(remainingItems[0]);
		renumberOrderedList(remainingList, 1);
	}

	rebuildListRaw(remainingList);

	liftedBlocks.push(remainingList);
	return liftedBlocks;
}

// ── M1: merge list item into previous ──

/**
 * M1's target-finder: given a list and the index of the current item being
 * backspaced, find the "deepest visible text above" by descending the
 * previous item's subtree last-child-first.
 *
 * Returns a uniform path (every child-array index explicit) from `list` down
 * to the target paragraph leaf, or null when no prose leaf is reachable
 * (walker hit opaque content or an empty container).
 *
 * The result is directly consumable by rebuildAncestryRaw without any
 * path-shape adaptation.
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
 * Merge the list item at `currentIndex` (currentIndex > 0) into the target
 * found by rule B: the deepest text-bearing paragraph reachable by walking
 * down the LAST children of the preceding item's subtree. Mutates `list`
 * in place.
 *
 * Child placement follows "preserve absolute indent": remaining children of
 * the current item (those after the first paragraph) are placed at their
 * original absolute list-nesting depth, along the target's ancestry chain.
 * listItem children slot into the container at their original depth;
 * non-listItem children (e.g., extra paragraphs) are absorbed into the
 * target item's inner children.
 *
 * Returns the merge point so the caller can position the cursor:
 *   targetPath: uniform path (every child-array index explicit) from `list` down
 *               to the target listItem — the trailing paragraph index (0) is stripped
 *               so the caller can append 0 itself when cascading through focusByPath.
 *   offset:     display-length position within the target paragraph, before the appended content
 */
export function mergeListItemIntoPrevious(
	list: CstNode,
	currentIndex: number
): { mergePoint: { targetPath: number[]; offset: number } } {
	if (
		list.kind !== 'list' ||
		!list.children ||
		currentIndex <= 0 ||
		currentIndex >= list.children.length
	) {
		throw new Error(`mergeListItemIntoPrevious: invalid currentIndex ${currentIndex}`);
	}

	const previousIndex = currentIndex - 1;
	const targetPath = findDeepestVisibleTextTarget(list, previousIndex);
	if (!targetPath) {
		throw new Error(
			'mergeListItemIntoPrevious: could not find target — previous item has no text-bearing leaf'
		);
	}

	// Walk the uniform path from list down to the target paragraph, stopping one
	// step before the leaf so we land on the target listItem.
	let targetItem: CstNode = list;
	for (let i = 0; i < targetPath.length - 1; i++) {
		targetItem = targetItem.children![targetPath[i]];
	}
	// After this loop, targetItem is the listItem directly containing the
	// target paragraph. The walker picked the LAST child at every descent
	// step, so the target paragraph's index within targetItem is the last
	// element of targetPath — NOT always 0. For a loose list item whose
	// children are [para "first", para "second"], the walker returns
	// path ending in 1, and reading children[0] would silently mutate
	// the wrong paragraph.
	const targetParagraphIndex = targetPath[targetPath.length - 1];
	const targetParagraph = targetItem.children?.[targetParagraphIndex];
	if (!targetParagraph || targetParagraph.kind !== 'paragraph') {
		throw new Error('mergeListItemIntoPrevious: target path does not end at a paragraph');
	}
	const targetOriginalText = (targetParagraph.raw ?? '').replace(/\r?\n$/, '');
	const mergeOffset = targetOriginalText.length;

	const currentItem = list.children[currentIndex];
	if (
		!currentItem.children ||
		currentItem.children.length === 0 ||
		currentItem.children[0].kind !== 'paragraph'
	) {
		throw new Error('mergeListItemIntoPrevious: current item does not start with a paragraph');
	}

	const currentFirstParagraph = currentItem.children[0];
	const currentFirstText = (currentFirstParagraph.raw ?? '').replace(/\r?\n$/, '');

	// 1. Append current's first-paragraph text to target's paragraph
	const lineEnding = (targetParagraph.raw ?? '').endsWith('\r\n') ? '\r\n' : '\n';
	targetParagraph.raw = targetOriginalText + currentFirstText + lineEnding;

	// 2. Relocate current's remaining children by preserve-absolute-indent.
	// currentItem is at depth 0 (top-level in `list`). Its children that are list items
	// were originally at depth 1. They should be placed at depth 1 in the target's
	// ancestry, which means: in the container at depth 1 along target's path.
	//
	// targetPath is a uniform path: [topItemIdx, nestedListIdx, innerItemIdx,
	// ..., paragraphIdx]. Length is always even — each nesting level adds two
	// indices (listItem + its nested list) and the trailing paragraph adds one
	// more, offset by the one-index "top item" base. Depth-0 target: length 2
	// (flat list). Depth-1 target: length 4. Depth-N target: length 2(N+1).
	//
	// If target is at depth 0 (targetPath.length === 2: [itemIdx, 0]), the container at
	// depth 1 along target's ancestry doesn't exist — fall through to absorb children
	// as new children of the target item.
	//
	// If target is at depth >= 1 (targetPath.length >= 4), the depth-1 container exists
	// and we promote current's nested-list items to be siblings of the target's ancestor
	// at depth 1.

	const remainingChildren = currentItem.children.slice(1);

	for (const child of remainingChildren) {
		if (child.kind === 'list' && child.children) {
			// child is a nested list whose items are at depth 1 (relative to currentItem's depth 0)
			// Find the container at depth 1 along target's ancestry.
			if (targetPath.length >= 4) {
				// depth ≥ 1: a nested-list container exists along the target's ancestry
				// Target is at depth >= 1. The depth-1 container is the last nested list
				// inside list.children[targetPath[0]].
				const depthOneParent = list.children[targetPath[0]];
				if (depthOneParent.children) {
					let depthOneList: CstNode | undefined;
					for (const c of depthOneParent.children) {
						if (c.kind === 'list') depthOneList = c;
					}
					if (depthOneList && depthOneList.children) {
						// Append child.children (list items) to this list
						for (const item of child.children) {
							item.leadingTrivia = '';
							depthOneList.children.push(item);
						}
						rebuildListRaw(depthOneList);
						continue;
					}
				}
			}
			// No depth-1 container along target ancestry — absorb into targetItem's children
			targetItem.children.push(child);
		} else {
			// Non-list child (paragraph, heading, etc.) — absorb into targetItem's children
			child.leadingTrivia = '';
			targetItem.children.push(child);
		}
	}

	// 3. Delete current item from the list
	list.children.splice(currentIndex, 1);

	// 4. Rebuild raw for all affected container nodes along the target's ancestry.
	// targetPath is already a uniform path (every child-array index explicit), ending
	// at the paragraph leaf. rebuildAncestryRaw expects exactly that shape, so no
	// expansion is needed — just call it directly.
	rebuildAncestryRaw(list, targetPath);

	// 5. Renumber ordered markers at the top level
	if ((list.metadata as { ordered?: boolean } | undefined)?.ordered) {
		renumberOrderedList(list);
		rebuildListRaw(list);
	}

	// Return the merge point. Strip the trailing paragraph index (always 0) from
	// targetPath before returning, so the returned targetPath ends at the target
	// listItem. ListBlock.svelte appends a 0 itself when cascading focus via
	// focusByPath, so stripping it here keeps the caller's convention intact.
	// targetPath ends at the paragraph leaf — required for the resolver loop
	// above and for rebuildAncestryRaw, both of which need the full path. Strip
	// the trailing paragraph index before returning, so ListBlock.svelte's
	// focusByPath cascade can re-append 0 via its existing [...restPath, 0]
	// convention.
	return { mergePoint: { targetPath: targetPath.slice(0, -1), offset: mergeOffset } };
}
