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
import { lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { nodeAt } from '../tree-operations/node-ops';
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import { rebuildAncestryRawForLeaf } from '../schema/container-raw';
import { involvesTable, tableAwareRangeDelete } from './range-delete-table';

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

	if (involvesTable(startBlock as CstNode, endBlock as CstNode)) {
		return tableAwareRangeDelete(doc, start, end, startBlock as CstNode, endBlock as CstNode);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = (startBlock as CstNode).raw;
	const endRaw = (endBlock as CstNode).raw;
	const mergedRaw = startRaw.slice(0, start.offset) + endRaw.slice(end.offset);

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		(startBlock as CstNode).raw = mergedRaw;
		rebuildAncestryRawForLeaf(doc, start.path);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: start.offset }
		};
	}

	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];

	// walkBetween includes ancestors of `end` whose subtrees extend past end —
	// filter to paths with subtrees fully inside (start, end). Cascade-cleanup
	// handles ancestors that become empty after their children are removed.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Identity-check before splice: a deeper delete + cascade may shift a
	// survivor into an outer path's slot. Cascade is identity-gated alongside
	// the delete so we never walk a survivor's ancestors with a stale path.
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const reverseSortedIndices = deletionPaths
		.map((_, i) => i)
		.sort((a, b) => comparePaths(deletionPaths[b], deletionPaths[a]));
	for (const i of reverseSortedIndices) {
		const path = deletionPaths[i];
		if (nodeAt(doc, path) === targetNodes[i]) {
			deleteAtPath(doc, path);
			cascadeCleanupEmptyAncestors(doc, path, lcaPath);
		}
	}

	replaceAtPath(doc, start.path, replacement);

	rebuildAncestryRawForLeaf(doc, start.path);
	for (const path of deletionPaths) {
		rebuildAncestryRawForLeaf(doc, path);
	}

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
}
