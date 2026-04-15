/**
 * Kind-agnostic tree mutations: split, merge, delete, update, and ancestry
 * raw-rebuild dispatch. These operate on any NodeParent regardless of the
 * children's block kinds. Kind-specific unwrap and merge logic lives in
 * sibling files (`list.ts`, `blockquote.ts`).
 */

import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { generateBlockId } from '../mutable-tree';
import { trimTrailingLineEnding } from '../raw-text';
import { rebuildBlockquoteRaw, rebuildListRaw, rebuildListItemRaw } from './container-raw';

// ── Types ──

export type NodeParent = { children: CstNode[] };

// ── Split ──

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

// ── Merge ──

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
export function mergeWithNext(parent: NodeParent, blockIds: string[], blockIndex: number): void {
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

// ── Delete ──

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

// ── Update Content ──

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

// ── Reparse helper (private) ──

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

// ── Editable container backfill ──

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

// ── Ancestry raw rebuild ──

/**
 * Rebuild `raw` for every container along a path, from innermost to outermost.
 *
 * Given a root container node and a path (sequence of child-array indices
 * from root down to a target leaf), walks each container along the path and
 * calls the kind-appropriate rebuild helper. The leaf itself (the last node
 * pointed at by the path) is NOT rebuilt — the caller is expected to have
 * already mutated the leaf's raw before calling this.
 *
 * Used by cross-container merge (Editor.mergeWithPrevious) and by M1's
 * mergeListItemIntoPrevious (via the refactor in Task 4).
 */
export function rebuildAncestryRaw(root: CstNode, path: number[]): void {
	if (path.length === 0) {
		// Rebuild just the root container. Valid when the caller wants to
		// refresh `root.raw` without having mutated anything deeper — e.g.,
		// after a top-level child was replaced directly. If `root` is not a
		// container, `rebuildContainerRaw` throws (enforced in Fix 1).
		rebuildContainerRaw(root);
		return;
	}

	// Collect containers along the path, from outermost-inside-root to innermost.
	// path.length - 1 stops before the leaf index (we don't descend into the leaf).
	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	// Rebuild innermost first (end of the array), then walk outward.
	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i]);
	}
	// Finally rebuild root itself.
	rebuildContainerRaw(root);
}

/**
 * Dispatch to the correct per-kind rebuild helper. Private — only used by
 * rebuildAncestryRaw and future callers that need kind-dispatched rebuilding.
 */
function rebuildContainerRaw(node: CstNode): void {
	switch (node.kind) {
		case 'blockquote':
			rebuildBlockquoteRaw(node);
			return;
		case 'list':
			rebuildListRaw(node);
			return;
		case 'listItem':
			rebuildListItemRaw(node);
			return;
		default:
			// rebuildAncestryRaw should only ever traverse containers. Reaching
			// this branch means either an off-by-one in the caller's path (the
			// path included the leaf index instead of stopping before it) or a
			// new container kind was added to BlockKind without updating this
			// switch. Either way, silent no-op would produce corrupt serialized
			// output — throw loudly instead.
			throw new Error(
				`rebuildContainerRaw: unexpected kind "${node.kind}" — only container kinds (blockquote, list, listItem) are valid`
			);
	}
}
