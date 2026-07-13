/**
 * Deletion ceremony shared by every rangeDelete branch (generic, chrome,
 * table): covered paths are spliced identity-gated in reverse doc order,
 * cascading empty-ancestor cleanup per delete. The wall branches (chrome, table)
 * additionally reduce covered paths to subtree roots so a container dies as ONE
 * splice with children intact — a commit scope or undo entry holding the
 * detached node stays invariant-clean.
 */

import type { Document } from '../core/nodes';
import { comparePaths, isStrictAncestorOf } from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { deleteAtPath } from '../tree-operations/path-mutate';
import { nodeAt } from '../tree-operations/node-ops';

/**
 * Subtree roots only: one splice per covered subtree, never a child-by-child
 * emptying of a container that is about to die.
 */
export function filterToSubtreeRoots(paths: number[][]): number[][] {
	return paths.filter((p) => !paths.some((q) => isStrictAncestorOf(q, p)));
}

/**
 * Identity-gated reverse-doc-order deletion: a deeper delete + cascade can
 * shift a survivor into an outer slot, so each path is re-resolved and only
 * spliced while it still holds the node captured up front. Caller must own
 * every parent spine BEFORE calling (G1.9) so the capture sees post-unshare
 * identities.
 */
export function deleteSubtreesIdentityGated(
	doc: Document,
	deletionPaths: number[][],
	lcaPath: number[]
): void {
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
}
