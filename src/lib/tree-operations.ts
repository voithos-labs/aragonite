/**
 * Pure tree mutation functions for the editor.
 * All functions operate on a NodeParent in place.
 */

import type { CstNode } from './core/nodes';
import { parse } from './core/parser';
import { generateBlockId, trimTrailingLineEnding, cloneNode } from './mutable-tree';
import { rebuildBlockquoteRaw, rebuildListRaw, rebuildListItemRaw } from './container-raw';

// ── Types ────────────────────────────────────────────────────────────────────

export type NodeParent = { children: CstNode[] };

// ── Split ───────────────────────────────────────────────────────────────────

/**
 * Split the node at `blockIndex` into two nodes at the given raw `offset`.
 * The first node keeps the original ID. A new ID is inserted for the second node.
 * Both halves are re-parsed to determine their block type.
 *
 * The offset is relative to the displayed text content (without trailing line ending).
 * The line ending style (\n or \r\n) is preserved from the original raw.
 */
export function splitNode(
	parent: NodeParent,
	blockIds: string[],
	blockIndex: number,
	offset: number
): void {
	const node = parent.children[blockIndex];
	const rawText = node.raw;

	// Detect line ending style from the original raw
	const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

	// Split the raw text at the offset
	let firstRaw = rawText.slice(0, offset);
	let secondRaw = rawText.slice(offset);

	// Ensure the first part ends with a line ending
	if (!firstRaw.endsWith('\n')) {
		firstRaw += lineEnding;
	}

	// Ensure the second part ends with a line ending
	if (secondRaw.length === 0 || !secondRaw.endsWith('\n')) {
		if (secondRaw.length === 0) {
			secondRaw = lineEnding;
		} else {
			secondRaw += lineEnding;
		}
	}

	const firstNode = reparseAsNode(firstRaw, node.leadingTrivia);
	const secondNode = reparseAsNode(secondRaw, '');

	// Replace the original node with the two new nodes
	parent.children.splice(blockIndex, 1, firstNode, secondNode);

	// Update IDs: original stays, new one inserted after
	blockIds.splice(blockIndex + 1, 0, generateBlockId());
}

// ── Merge ───────────────────────────────────────────────────────────────────

/**
 * Merge the node at `blockIndex` into the node at `blockIndex - 1`.
 * The combined raw text is re-parsed. The first block's ID is kept.
 * No-op if blockIndex is 0.
 */
export function mergeWithPrevious(
	parent: NodeParent,
	blockIds: string[],
	blockIndex: number
): void {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return;

	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	// Strip trailing line ending from prev so the merged text flows together
	const mergedRaw = trimTrailingLineEnding(prev.raw) + curr.raw;

	const mergedNode = reparseAsNode(mergedRaw, prev.leadingTrivia);

	// Replace both nodes with the merged node
	parent.children.splice(blockIndex - 1, 2, mergedNode);

	// Remove the second block's ID
	blockIds.splice(blockIndex, 1);
}

/**
 * Merge the node at `blockIndex` with the node at `blockIndex + 1`.
 * The combined raw text is re-parsed. The current block's ID is kept.
 * No-op if blockIndex is the last block.
 */
export function mergeWithNext(
	parent: NodeParent,
	blockIds: string[],
	blockIndex: number
): void {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) return;

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	// Strip trailing line ending from current so the merged text flows together
	const mergedRaw = trimTrailingLineEnding(curr.raw) + next.raw;

	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia);

	// Replace both nodes with the merged node
	parent.children.splice(blockIndex, 2, mergedNode);

	// Remove the next block's ID
	blockIds.splice(blockIndex + 1, 1);
}

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Remove the node at `blockIndex`.
 * Transfers leading trivia to the next sibling if one exists.
 */
export function deleteNode(parent: NodeParent, blockIds: string[], blockIndex: number): void {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return;

	const deleted = parent.children[blockIndex];

	// Transfer leading trivia to the next block
	if (blockIndex + 1 < parent.children.length) {
		parent.children[blockIndex + 1].leadingTrivia =
			deleted.leadingTrivia + parent.children[blockIndex + 1].leadingTrivia;
	}

	parent.children.splice(blockIndex, 1);
	blockIds.splice(blockIndex, 1);
}

// ── Update Content ──────────────────────────────────────────────────────────

/**
 * Update the raw text of the node at `blockIndex` and re-parse to check
 * for block type changes. Returns whether the kind changed.
 */
export function updateNodeContent(
	parent: NodeParent,
	blockIndex: number,
	newText: string
): { kindChanged: boolean; newKind?: string } {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;

	const reparsed = reparseAsNode(newText, node.leadingTrivia);

	// Update the node in place — copy all fields so leaf↔container transitions
	// (e.g., paragraph → list) propagate children and container structure
	node.raw = newText;
	node.kind = reparsed.kind;
	node.metadata = reparsed.metadata;
	node.children = reparsed.children;
	node.innerPrefix = reparsed.innerPrefix;
	node.innerSuffix = reparsed.innerSuffix;

	const kindChanged = node.kind !== oldKind;
	return {
		kindChanged,
		newKind: kindChanged ? node.kind : undefined
	};
}

/**
 * Parse a raw string as a single block node.
 * The parser produces mutable plain objects directly — no conversion needed.
 */
function reparseAsNode(raw: string, leadingTrivia: string): CstNode {
	const doc = parse(raw);
	if (doc.children.length > 0) {
		const node = doc.children[0];
		node.leadingTrivia = leadingTrivia;
		ensureEditableContainers(node);
		return node;
	}

	return { kind: 'paragraph', leadingTrivia, raw };
}

/**
 * Ensure every container node in the tree has at least one child block.
 * Without this, container blocks (e.g., a list item with no content after
 * the marker) would have no editing surface for the cursor.
 */
export function ensureEditableContainers(node: CstNode): void {
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			node.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
		for (const child of node.children) {
			ensureEditableContainers(child);
		}
	}
}

// ── Container Unwrap ────────────────────────────────────────────────────────

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

	// Renumber ordered markers from the base of the original list
	if (parentOrdered) {
		// Determine the original starting number from the first item's original marker.
		const originalFirstMarker = (firstItem.metadata as { marker: string }).marker;
		const match = originalFirstMarker.match(/^(\d+)/);
		const base = match ? parseInt(match[1], 10) : 1;
		for (let i = 0; i < remainingItems.length; i++) {
			const meta = remainingItems[i].metadata as { marker: string };
			const suffix = meta.marker.replace(/^\d+/, '');
			meta.marker = String(base + i) + suffix;
			rebuildListItemRaw(remainingItems[i]);
		}
	}

	const remainingList: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: clonedList.metadata ? { ...clonedList.metadata } : { ordered: parentOrdered },
		children: remainingItems,
		innerPrefix: clonedList.innerPrefix ?? '',
		innerSuffix: clonedList.innerSuffix ?? ''
	};
	rebuildListRaw(remainingList);

	liftedBlocks.push(remainingList);
	return liftedBlocks;
}

// ── List Item Merge ─────────────────────────────────────────────────────────

/**
 * Walk an item's subtree depth-first, preferring the LAST child at each level,
 * to find the "deepest visible text" target (rule B). Returns the path to the
 * target list item, or null if no text-bearing paragraph is found.
 *
 * Path convention: each element is the index of a list item within its
 * enclosing list. path[0] is the top-level item index in `list`; path[1] is
 * the index within that item's last nested list (if any); path[2] is the
 * index within that nested list's last item's last nested list; etc.
 */
function findDeepestVisibleTextTarget(list: CstNode, targetItemIndex: number): number[] | null {
	if (!list.children || targetItemIndex < 0 || targetItemIndex >= list.children.length) {
		return null;
	}

	// Start at the target item. Descend into its LAST nested-list's LAST item
	// repeatedly while such a nested list exists.
	const path: number[] = [targetItemIndex];
	let current = list.children[targetItemIndex];

	while (current.children && current.children.length > 0) {
		// Look at the last child of the current item
		const lastChild = current.children[current.children.length - 1];
		if (lastChild.kind === 'list' && lastChild.children && lastChild.children.length > 0) {
			// Descend into the last item of this nested list
			const lastItemIndex = lastChild.children.length - 1;
			path.push(lastItemIndex);
			current = lastChild.children[lastItemIndex];
		} else {
			break;
		}
	}

	return path;
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
 *   targetPath: chain of child indices from `list` down to the target listItem
 *   offset:     display-length position within the target paragraph, before the appended content
 */
export function mergeListItemIntoPrevious(
	list: CstNode,
	currentIndex: number
): { mergePoint: { targetPath: number[]; offset: number } } {
	if (list.kind !== 'list' || !list.children || currentIndex <= 0 || currentIndex >= list.children.length) {
		throw new Error(`mergeListItemIntoPrevious: invalid currentIndex ${currentIndex}`);
	}

	const previousIndex = currentIndex - 1;
	const targetPath = findDeepestVisibleTextTarget(list, previousIndex);
	if (!targetPath) {
		throw new Error('mergeListItemIntoPrevious: could not find target — previous item has no text-bearing leaf');
	}

	// Resolve the target listItem by walking the path.
	function resolveItem(list: CstNode, path: number[]): CstNode {
		let item = list.children![path[0]];
		for (let i = 1; i < path.length; i++) {
			// At each hop, item's LAST child should be the nested list we descend into.
			const nestedList = item.children![item.children!.length - 1];
			item = nestedList.children![path[i]];
		}
		return item;
	}
	const targetItem = resolveItem(list, targetPath);

	if (!targetItem.children || targetItem.children.length === 0 || targetItem.children[0].kind !== 'paragraph') {
		throw new Error('mergeListItemIntoPrevious: target item does not start with a paragraph');
	}

	const targetParagraph = targetItem.children[0];
	const targetOriginalText = (targetParagraph.raw ?? '').replace(/\r?\n$/, '');
	const mergeOffset = targetOriginalText.length;

	const currentItem = list.children[currentIndex];
	if (!currentItem.children || currentItem.children.length === 0 || currentItem.children[0].kind !== 'paragraph') {
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
	// ancestry, which means: in the container at depth 1 along target's path, which is
	// the last nested list inside targetPath[0]'s item (if one exists).
	//
	// If target is at depth 0 (targetPath.length === 1), the container at depth 1 along
	// target's ancestry doesn't exist. In that case, fall through to absorbing children
	// as new children of the target item.
	//
	// If target is at depth >= 1 (targetPath.length >= 2), the depth-1 container exists
	// and we promote current's nested-list items to be siblings of the target's ancestor
	// at depth 1.

	const remainingChildren = currentItem.children.slice(1);

	for (const child of remainingChildren) {
		if (child.kind === 'list' && child.children) {
			// child is a nested list whose items are at depth 1 (relative to currentItem's depth 0)
			// Find the container at depth 1 along target's ancestry.
			if (targetPath.length >= 2) {
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

	// 4. Rebuild raw for all affected container nodes
	// The target item may be deeply nested — rebuild it and all ancestors.
	function rebuildFromPath(list: CstNode, path: number[]): void {
		// Rebuild deepest first, then walk up
		if (path.length === 0) {
			rebuildListRaw(list);
			return;
		}
		// Resolve the item at this path
		function resolveItemByPath(list: CstNode, p: number[]): CstNode {
			let item = list.children![p[0]];
			for (let i = 1; i < p.length; i++) {
				const nl = item.children![item.children!.length - 1];
				item = nl.children![p[i]];
			}
			return item;
		}
		const item = resolveItemByPath(list, path);
		rebuildListItemRaw(item);
		// Walk up one level
		if (path.length > 1) {
			const parentPath = path.slice(0, -1);
			// Rebuild the nested list that contained `item`
			const parentItem = resolveItemByPath(list, parentPath);
			for (const child of parentItem.children ?? []) {
				if (child.kind === 'list') rebuildListRaw(child);
			}
			rebuildFromPath(list, parentPath);
		} else {
			rebuildListRaw(list);
		}
	}
	rebuildFromPath(list, targetPath);

	// 5. Renumber ordered markers at the top level
	const ordered = (list.metadata as { ordered: boolean } | undefined)?.ordered ?? false;
	if (ordered) {
		for (let j = 0; j < list.children.length; j++) {
			const prev = j > 0
				? (list.children[j - 1].metadata as { marker: string }).marker
				: '0. ';
			const prevNum = parseInt(prev, 10) || 0;
			const meta = list.children[j].metadata as { marker: string };
			const suffix = meta.marker.replace(/^\d+/, '');
			meta.marker = String(prevNum + 1) + suffix;
			rebuildListItemRaw(list.children[j]);
		}
		rebuildListRaw(list);
	}

	return { mergePoint: { targetPath, offset: mergeOffset } };
}

/**
 * Compute the result of unwrapping a blockquote's first child.
 * Returns the blocks that should replace the blockquote in its parent's
 * children array.
 * - 1-child blockquote: returns [liftedChild]
 * - N-child blockquote: returns [liftedChild, remainingBlockquote]
 * Input is not mutated; returned blocks are fresh clones via cloneNode
 * (omits the inlineContent rendering cache).
 */
export function unwrapFirstChildFromBlockquote(blockquote: CstNode): CstNode[] {
	if (blockquote.kind !== 'blockquote' || !blockquote.children || blockquote.children.length === 0) {
		return [];
	}

	// Deep clone children to avoid mutating the input.
	const clonedChildren: CstNode[] = blockquote.children.map(cloneNode);

	const lifted = clonedChildren[0];
	// Lifted child becomes a top-level block in the parent — clear its leading trivia
	// because it inherits the blockquote's position, and the blockquote's leading
	// trivia is applied at the caller's splice point.
	lifted.leadingTrivia = '';

	if (clonedChildren.length === 1) {
		return [lifted];
	}

	// Build the remaining blockquote as a fresh node.
	const remainingChildren = clonedChildren.slice(1);
	// The first remaining child loses its leading-blank-line trivia since it's now
	// the first child of the shrunk blockquote — any gap between it and the lifted
	// block is represented at the parent level (separate blocks in the parent list).
	remainingChildren[0].leadingTrivia = '';

	const remaining: CstNode = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: blockquote.metadata ? { ...blockquote.metadata } : undefined,
		children: remainingChildren,
		innerPrefix: blockquote.innerPrefix ?? '',
		innerSuffix: blockquote.innerSuffix ?? ''
	};
	rebuildBlockquoteRaw(remaining);

	return [lifted, remaining];
}
