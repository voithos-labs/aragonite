/**
 * Core range mutation primitive. Takes a Document and a normalized range
 * ({start, end}) and mutates the document: truncate start block, truncate
 * end block, delete everything between, re-parse merged raw, cascade-clean
 * empty ancestors, and rebuild container raw up each affected ancestor
 * chain. Caller must normalize the range before calling.
 *
 * Used by cross-block Cut, Paste, Backspace, Delete, and type-replace.
 * See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
 * Range Mutations section for the full algorithm and "start wins" semantics.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import { parse } from '../core/parser';
import { walkBetween, comparePaths } from './primitives';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { nodeAt } from '../tree-operations/node-ops';
import { rebuildContainerRawIfContainer } from '../tree-operations/container-raw';

// ── Public API ──────────────────────────────────────────────────────────────

export interface RangeDeleteResult {
	newDoc: Document;
	collapsedCaret: SelectionPoint;
}

/**
 * Delete the range [start, end] from `doc`, merge the endpoint blocks at
 * start's position with start's container context preserved, cascade-clean
 * empty ancestors of deleted blocks, and rebuild container raw along every
 * ancestor chain that touched a mutation. Returns the mutated `doc`
 * (mutated in place — the parameter and `newDoc` reference the same
 * object) and the collapsed caret position inside the merged block.
 *
 * Caller must ensure `start` and `end` are normalized (start <= end in doc
 * order) via `primitives.normalize`. Caller must also ensure neither
 * endpoint lands on a non-focusable block.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint
): RangeDeleteResult {
	const startBlock = nodeAt(doc, start.path);
	const endBlock = nodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a node');
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = (startBlock as CstNode).raw;
	const endRaw = (endBlock as CstNode).raw;
	const mergedRaw = startRaw.slice(0, start.offset) + endRaw.slice(end.offset);

	if (sameBlock) {
		// Same-block: overwrite raw directly. No deletion, no cascade cleanup.
		// Still need to rebuild ancestor container raws — this block may be
		// nested inside a blockquote/list/listItem whose serialized form
		// depends on its descendants' raws.
		(startBlock as CstNode).raw = mergedRaw;
		rebuildAncestryContainerRaw(doc, start.path);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: start.offset }
		};
	}

	// Cross-block: re-parse the merged raw. May produce 0, 1, or more blocks;
	// an empty parse result is replaced with a blank paragraph so the slot
	// vacated by startBlock always receives at least one node.
	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];

	// Deletion targets: every path strictly between start and end, plus
	// end.path itself. start.path is not deleted — its node is replaced by
	// the merged block(s) below.
	const betweenPaths = walkBetween(doc, start.path, end.path);
	const deletionPaths: number[][] = [...betweenPaths, end.path];

	// Cascade cleanup must not walk above the LCA of start/end — containers
	// at or above still hold the merged replacement and can't be empty.
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Apply in REVERSE document order so earlier paths aren't invalidated mid-iteration.
	const reverseSortedDeletions = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSortedDeletions) {
		deleteAtPath(doc, path);
	}

	replaceAtPath(doc, start.path, replacement);

	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	// Rebuild along both chains: start-path ancestors because the replacement
	// changed their contents, deleted-path ancestors because their children
	// arrays shrank (cascade-cleanup may also have removed intermediates).
	rebuildAncestryContainerRaw(doc, start.path);
	for (const path of deletionPaths) {
		rebuildAncestryContainerRaw(doc, path);
	}

	// For replacement.length === 1 the caret lands inside the merged block at
	// start.path/start.offset. For N > 1 (rare) the caret still lands there
	// because replacement[0] occupies the original slot.
	const collapsedCaret: SelectionPoint = {
		path: start.path.slice(),
		offset: start.offset
	};
	return { newDoc: doc, collapsedCaret };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return; // Can't delete the root.
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		parent.children.splice(idx, 1);
	}
}

function replaceAtPath(doc: Document, path: number[], replacement: CstNode[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	parent.children.splice(idx, 1, ...replacement);
}

function lowestCommonAncestor(a: number[], b: number[]): number[] {
	const result: number[] = [];
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) break;
		result.push(a[i]);
	}
	return result;
}

/**
 * Rebuild `raw` for every container ancestor of `leafPath`, innermost-first.
 * The document root is never rebuilt (serialization reads children directly).
 * Missing ancestors (e.g., removed by cascade cleanup) short-circuit the walk.
 */
function rebuildAncestryContainerRaw(doc: Document, leafPath: number[]): void {
	// Walk from the deepest ancestor (leafPath.length - 1) down to the shallowest (1).
	// Stopping at length 1 means ancestorPath = [idx], i.e. a direct child of
	// document root — that node may itself be a container whose raw needs rebuild.
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = leafPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath);
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildContainerRawIfContainer(ancestor as CstNode);
	}
}
