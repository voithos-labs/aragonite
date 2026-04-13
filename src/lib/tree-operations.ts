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
 * Compute the result of unwrapping a blockquote's first child.
 * Returns the blocks that should replace the blockquote in its parent's
 * children array.
 * - 1-child blockquote: returns [liftedChild]
 * - N-child blockquote: returns [liftedChild, remainingBlockquote]
 * Input is not mutated; returned blocks are fresh clones via cloneNode
 * (omits the inlineContent rendering cache).
 */
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
