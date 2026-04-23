/**
 * List-kind tree operations: emptiness predicates, ordered-marker bookkeeping,
 * U1 first-item unwrap, M1 non-first-item merge, and exit-conversion replacement
 * for Enter-on-empty-item. Pure tree mutations — no Svelte, no DOM.
 */

import type { CstNode } from '../core/nodes';
import { cloneNode } from './clone';
import { rebuildListRaw, rebuildListItemRaw, rebuildAncestryRaw } from './container-raw';
import { walkToDeepestMergeLeaf } from './merge-rules';

// ── Emptiness check ──

/**
 * A list item is "user-empty" when every leaf descendant's raw is blank.
 * Stronger than "first child is an empty paragraph" — the shallow check
 * dropped trailing content (extra paragraphs, nested lists) when the first
 * paragraph happened to be empty.
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
 * Renumber an ordered list's items in place starting at `fromIndex`. No-op
 * on unordered lists. Preserves each item's marker suffix (`. ` vs `) `).
 *
 * When `fromIndex` is 0 this resets the sequence to 1, not to the list's
 * original start number. Callers that need a non-1 base must seed item 0
 * manually and then call with `fromIndex=1`.
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
 * unordered). Templates the suffix (`*`/`+`/`-` or `.`/`)`) from a sibling
 * so destination-list choices are preserved. No-op when already matching.
 * Caller renumbers afterward — this only touches marker style.
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
		const suffix = templateMarker?.replace(/^\d+/, '') ?? '. ';
		meta.marker = '1' + suffix;
	} else {
		meta.marker = templateMarker ?? '- ';
	}
	rebuildListItemRaw(item);
}

// ── U1: unwrap first item from list ──

/**
 * Compute the result of unwrapping a list's first item under Rule U1.
 * Output order for mixed-content first item: first paragraph, then other
 * non-list children, then mismatched-type sub-lists, then the shrunk
 * parent list (with matching-type sub-list items prepended and ordered
 * markers renumbered). Input is not mutated.
 */
export function unwrapFirstItemFromList(list: CstNode): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	const clonedList: CstNode = cloneNode(list);
	const parentOrdered = (clonedList.metadata as { ordered: boolean } | undefined)?.ordered ?? false;

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
			const childOrdered = (child.metadata as { ordered: boolean } | undefined)?.ordered ?? false;
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
		metadata: clonedList.metadata ? { ...clonedList.metadata } : { ordered: parentOrdered },
		children: remainingItems,
		innerPrefix: clonedList.innerPrefix ?? '',
		innerSuffix: clonedList.innerSuffix ?? ''
	};

	// Preserve the original list's starting number: seed item 0, then
	// continue the sequence from item 1.
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
 */
export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number
): { mergePoint: { targetPath: number[]; offset: number } } {
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
	if (!targetPath) {
		throw new Error(
			'mergeListItemIntoPrevious: could not find target — previous item has no text-bearing leaf'
		);
	}

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

	// Relocate remaining children by "preserve absolute indent":
	// targetPath is a uniform path of length 2(N+1) where N is target's nesting depth.
	// Depth-0 target (length 2): no depth-1 container — absorb into targetItem.
	// Depth-≥1 target (length ≥ 4): promote nested-list items to the depth-1 sibling container.
	const remainingChildren = currentItem.children.slice(1);

	for (const child of remainingChildren) {
		if (child.kind === 'list' && child.children) {
			if (targetPath.length >= 4) {
				const depthOneParent = list.children[targetPath[0]];
				if (depthOneParent.children) {
					let depthOneList: CstNode | undefined;
					for (const c of depthOneParent.children) {
						if (c.kind === 'list') depthOneList = c;
					}
					if (depthOneList && depthOneList.children) {
						for (const item of child.children) {
							item.leadingTrivia = '';
							// discovered-descendant mutation, see node-ops.ts header
							depthOneList.children.push(item);
						}
						rebuildListRaw(depthOneList);
						continue;
					}
				}
			}
			// discovered-descendant mutation, see node-ops.ts header
			targetItem.children!.push(child);
		} else {
			child.leadingTrivia = '';
			// discovered-descendant mutation, see node-ops.ts header
			targetItem.children!.push(child);
		}
	}

	children.splice(currentIndex, 1);

	// Sync list.children so post-splice reads (rebuildAncestryRaw,
	// renumberOrderedList, rebuildListRaw) see the new shape. Idempotent
	// with commitContainerStructural's final publish.
	list.children = children;

	rebuildAncestryRaw(list, targetPath);

	if ((list.metadata as { ordered?: boolean } | undefined)?.ordered) {
		renumberOrderedList(list);
		rebuildListRaw(list);
	}

	return { mergePoint: { targetPath, offset: mergeOffset } };
}

// ── Exit-list replacement builder ──

/**
 * Compute the parent-level replacement when a list item exits the list (Enter
 * on an empty-first-paragraph item). Layout:
 *   [firstHalfList?, exitParagraph, ...liftedBlocks, secondHalfList?]
 *
 * Matching-type nested list items rejoin the surviving list halves; everything
 * else lifts as separate top-level blocks in document order. `paragraphIndex`
 * is the exit paragraph's position in the returned array — callers pass it as
 * the focus target. Input is not mutated.
 */
export function buildExitReplacement(
	list: CstNode,
	itemIndex: number
): { blocks: CstNode[]; paragraphIndex: number } {
	const items = list.children ?? [];
	const exitedItem = items[itemIndex];
	const parentOrdered = (list.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;

	// Matching-type nested lists flatten into `promotedItems` for re-merge
	// into the surviving halves; everything else lifts as a top-level block.
	const promotedItems: CstNode[] = [];
	const liftedBlocks: CstNode[] = [];
	if (exitedItem?.children && exitedItem.children.length > 1) {
		for (const child of exitedItem.children.slice(1)) {
			if (child.kind === 'list' && child.children) {
				const childOrdered =
					(child.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
				if (childOrdered === parentOrdered) {
					for (const nestedItem of child.children) {
						const cloned = cloneNode(nestedItem);
						cloned.leadingTrivia = '';
						promotedItems.push(cloned);
					}
					continue;
				}
			}
			const lifted = cloneNode(child);
			lifted.leadingTrivia = '';
			liftedBlocks.push(lifted);
		}
	}

	const before = items.slice(0, itemIndex).map(cloneNode);
	const after = items.slice(itemIndex + 1).map(cloneNode);

	// wasFirstItem has no `before` half, so promotions slide into `after`.
	const wasFirstItem = itemIndex === 0;
	const firstHalfItems = wasFirstItem ? [] : [...before, ...promotedItems];
	const secondHalfItems = wasFirstItem ? [...promotedItems, ...after] : after;

	const exitParagraph: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '\n' };

	const blocks: CstNode[] = [];
	if (firstHalfItems.length > 0) {
		blocks.push(buildListHalf(list, firstHalfItems, 1));
	}
	const paragraphIndex = blocks.length;
	blocks.push(exitParagraph);
	for (const lifted of liftedBlocks) blocks.push(lifted);
	if (secondHalfItems.length > 0) {
		// Continue the sequence across the gap: 1, 2, [exit], 3 — not ...4
		// (the exited slot doesn't burn a number) and not ...1.
		const secondHalfStart =
			firstHalfItems.length > 0 ? firstHalfItems.length + 1 : orderedBaseOf(items[0]);
		blocks.push(buildListHalf(list, secondHalfItems, secondHalfStart));
	}

	return { blocks, paragraphIndex };
}

/**
 * Construct a list CST node carrying `items`, mirroring `template`'s metadata
 * and inner-prefix/suffix. Renumbers ordered markers starting at `startNumber`.
 */
function buildListHalf(template: CstNode, items: CstNode[], startNumber: number): CstNode {
	const half: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata ? { ...template.metadata } : { ordered: false },
		children: items,
		innerPrefix: template.innerPrefix ?? '',
		innerSuffix: template.innerSuffix ?? ''
	};
	if (items[0]) items[0].leadingTrivia = '';
	for (const item of items) rebuildListItemRaw(item);

	// renumberOrderedList's fromIndex=0 path always restarts at 1 — seed
	// items[0] manually to renumber from an arbitrary base.
	const ordered = (half.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	if (ordered && items.length > 0) {
		const firstMeta = items[0].metadata as { marker: string };
		const suffix = firstMeta.marker.replace(/^\d+/, '') || '. ';
		firstMeta.marker = String(startNumber) + suffix;
		rebuildListItemRaw(items[0]);
		renumberOrderedList(half, 1);
	}
	rebuildListRaw(half);
	return half;
}

/** Read an item's marker as an integer base, defaulting to 1 for non-numeric markers. */
function orderedBaseOf(item: CstNode | undefined): number {
	if (!item) return 1;
	const marker = (item.metadata as { marker?: string } | undefined)?.marker ?? '';
	const n = parseInt(marker, 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}
