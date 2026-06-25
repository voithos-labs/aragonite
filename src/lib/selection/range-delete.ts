/**
 * Core range mutation primitive. Mutates the doc in place: truncate start
 * block, truncate end block, delete between, re-parse merged raw, cascade-
 * clean empty ancestors, rebuild ancestor container raws. Caller must
 * pre-normalize the range. See the "start wins" rule in editor design docs.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { walkBetween, comparePaths, assertCharOffset } from './primitives';
import { lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { nodeAt } from '../tree-operations/node-ops';
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import {
	ensureUnsharedPath,
	rebuildUnsharedAncestry,
	rebuildUnsharedChain
} from '../tree-operations/unshare';
import { involvesTable, tableAwareRangeDelete } from './range-delete-table';

// ── Public API ──────────────────────────────────────────────────────────────

export interface RangeDeleteResult {
	newDoc: Document;
	collapsedCaret: SelectionPoint;
}

/**
 * Delete [start, end] in place, merge at start's position with its
 * container context preserved, cascade-clean empty ancestors, rebuild
 * container raws. Copy-path-on-write: every spine the op splices or writes
 * through is unshared up front — BEFORE target identities are captured, so
 * the identity gate compares post-unshare references. Returns the (mutated)
 * doc and the collapsed caret. Caller must pre-normalize the range and
 * ensure neither endpoint lands on a non-focusable block.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState
): RangeDeleteResult {
	const startBlock = nodeAt(doc, start.path);
	const endBlock = nodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a node');
	}

	if (involvesTable(startBlock as CstNode, endBlock as CstNode)) {
		return tableAwareRangeDelete(doc, start, end, sharing);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = (startBlock as CstNode).raw;
	const endRaw = (endBlock as CstNode).raw;
	const startOffset = assertCharOffset(start, 'rangeDelete:prose-merge-start');
	const endOffset = assertCharOffset(end, 'rangeDelete:prose-merge-end');
	const mergedRaw = startRaw.slice(0, startOffset) + endRaw.slice(endOffset);

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		const chain = ensureUnsharedPath(doc, start.path, sharing);
		const owned = chain[chain.length - 1] ?? (startBlock as CstNode);
		owned.raw = mergedRaw;
		rebuildUnsharedChain(chain, sharing);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: startOffset }
		};
	}

	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];
	for (const node of replacement) sharing.stamp(node);

	// walkBetween includes ancestors of `end` whose subtrees extend past end —
	// filter to paths with subtrees fully inside (start, end). Cascade-cleanup
	// handles ancestors that become empty after their children are removed.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Unshare every spliced spine before capturing target identities — a copy
	// made after capture would fail the identity gate and skip the deletion.
	ensureUnsharedPath(doc, start.path, sharing);
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}

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

	rebuildUnsharedAncestry(doc, start.path, sharing);
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing);
	}

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
}
