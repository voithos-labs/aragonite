/**
 * Core range mutation primitive. Mutates the doc in place: truncate start
 * block, truncate end block, delete between, re-parse merged raw, cascade-
 * clean empty ancestors, rebuild ancestor container raws. Caller must
 * pre-normalize the range. See the "start wins" rule in editor design docs.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import { parse } from '../core/parser';
import { walkBetween, comparePaths } from './primitives';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { nodeAt } from '../tree-operations/node-ops';
import { rebuildAncestryRawForLeaf } from '../tree-operations/container-raw';

// ── Public API ──────────────────────────────────────────────────────────────

export interface RangeDeleteResult {
	newDoc: Document;
	collapsedCaret: SelectionPoint;
}

/**
 * Delete [start, end] in place, merge at start's position with its
 * container context preserved, cascade-clean empty ancestors, rebuild
 * container raws. Returns the (mutated) doc and the collapsed caret.
 * Caller must pre-normalize the range and ensure neither endpoint lands
 * on a non-focusable block.
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
		// Ancestor rebuild is still needed — this block may be nested inside
		// a blockquote/list/listItem whose raw depends on descendant raws.
		(startBlock as CstNode).raw = mergedRaw;
		rebuildAncestryRawForLeaf(doc, start.path);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: start.offset }
		};
	}

	// Re-parse merged raw; fall back to a blank paragraph so start's slot
	// always gets at least one node.
	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];

	// start.path is replaced (not deleted); deletion targets are the paths
	// strictly between start and end, plus end.path.
	const betweenPaths = walkBetween(doc, start.path, end.path);
	const deletionPaths: number[][] = [...betweenPaths, end.path];

	// Cascade cleanup must stop at the LCA — ancestors at or above still
	// hold the merged replacement and can't be empty.
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Reverse doc order so earlier paths aren't invalidated mid-iteration.
	const reverseSortedDeletions = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSortedDeletions) {
		deleteAtPath(doc, path);
	}

	replaceAtPath(doc, start.path, replacement);

	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	// Rebuild both chains: start-path (replacement changed contents) and
	// deletion-path ancestors (children arrays shrank, possibly via cascade).
	rebuildAncestryRawForLeaf(doc, start.path);
	for (const path of deletionPaths) {
		rebuildAncestryRawForLeaf(doc, path);
	}

	// replacement[0] occupies start.path's slot, so the caret lands at
	// start.path/start.offset for every N >= 1.
	const collapsedCaret: SelectionPoint = {
		path: start.path.slice(),
		offset: start.offset
	};
	return { newDoc: doc, collapsedCaret };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return;
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
