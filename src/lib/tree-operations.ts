/**
 * Pure tree mutation functions for the editor.
 * All functions operate on a NodeParent in place.
 */

import type { CstNode } from './core/nodes';
import { parse } from './core/parser';
import { generateBlockId } from './mutable-tree';

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

	// Re-parse each half to determine block type
	const firstNode = reparseAsNode(firstRaw, node.leadingTrivia);
	// No blank line between split halves — empty leading trivia
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
	let prevContent = prev.raw;
	if (prevContent.endsWith('\r\n')) prevContent = prevContent.slice(0, -2);
	else if (prevContent.endsWith('\n')) prevContent = prevContent.slice(0, -1);

	const mergedRaw = prevContent + curr.raw;

	// Re-parse to determine the merged block type
	const mergedNode = reparseAsNode(mergedRaw, prev.leadingTrivia);

	// Replace both nodes with the merged node
	parent.children.splice(blockIndex - 1, 2, mergedNode);

	// Remove the second block's ID
	blockIds.splice(blockIndex, 1);
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

	// Re-parse the new text to determine block type
	const reparsed = reparseAsNode(newText, node.leadingTrivia);

	// Update the node in place
	node.raw = newText;
	node.kind = reparsed.kind;
	node.metadata = reparsed.metadata;

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
