/**
 * Deletion ceremony shared by every rangeDelete branch (generic, chrome,
 * table): covered paths are spliced identity-gated in reverse doc order,
 * cascading empty-ancestor cleanup per delete. The wall branches (chrome, table)
 * additionally reduce covered paths to subtree roots so a container dies as ONE
 * splice with children intact — a commit scope or undo entry holding the
 * detached node stays invariant-clean.
 */

import type { GrammarView } from '../schema/block-openers';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { walkBetween } from './primitives';
import {
	comparePaths,
	isStrictAncestorOf,
	isPathSubtreeBetween,
	lowestCommonAncestor,
	pathHasPrefix,
	pathsEqual
} from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { deleteAtPath } from '../tree-operations/path-mutate';
import { nodeAt } from '../tree-operations/node-ops';
import {
	ensureUnsharedPath,
	rebuildUnsharedAncestry,
	rebuildUnsharedChain
} from '../tree-operations/unshare';
// The reserved-chrome wall primitives live with the chrome branch; the shared
// wall-planning atoms below consume them, and the chrome branch imports those
// atoms back. The resulting ceremony↔chrome cycle is function-body-only — every
// cross-reference resolves at call time, never at module load — so it is safe.
import {
	nearestChromeContainer,
	rangeConsumesContainer,
	lastChildDescendant,
	type ChromeContainer
} from './range-delete-chrome';

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
	lcaPath: number[],
	sharing: SharingState
): void {
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const reverseSortedIndices = deletionPaths
		.map((_, i) => i)
		.sort((a, b) => comparePaths(deletionPaths[b], deletionPaths[a]));
	for (const i of reverseSortedIndices) {
		const path = deletionPaths[i];
		if (nodeAt(doc, path) === targetNodes[i]) {
			deleteAtPath(doc, path);
			cascadeCleanupEmptyAncestors(doc, path, lcaPath, sharing);
		}
	}
}

// ── Cross-block deletion plan (chrome + table branches) ─────────────────────
// The cross-block branches interleave their endpoint replaceAtPath differently
// (some before the deletes, some after — see each branch's ordering comment), so
// the steps stay separate atoms the callers sequence explicitly.

export interface EndWall {
	container: ChromeContainer;
	consumed: boolean;
}

/**
 * End-side wall context: the chrome container holding the end point, when the
 * range enters it from outside. `consumed` means the whole subtree is covered
 * — the chrome branch's last-byte rule for a prose end; for a table end, the
 * emptied table sitting on the container's last-child chain — so the container
 * unit-deletes instead of leaving a husk.
 */
export function resolveEndWall(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endTableEmptied: boolean | null
): EndWall | null {
	const container = nearestChromeContainer(doc, end.path);
	if (!container || pathHasPrefix(start.path, container.path)) return null;
	const consumed =
		endTableEmptied === null
			? rangeConsumesContainer(container, end)
			: endTableEmptied && lastChildDescendant(container, end.path) !== null;
	return { container, consumed };
}

export interface DeletionPlan {
	deletionPaths: number[][];
	chromeClearChain: CstNode[] | null;
	/** The epoch the plan was collected against; the apply step's splices own their
	 *  spines through it, so no case has to re-thread it. */
	sharing: SharingState;
}

/**
 * Covered subtree roots (chrome-ceremony parity: one splice per covered
 * subtree) plus endpoint paths the caller marks for removal, honoring the
 * chrome wall: a surviving end container's covered chrome CLEARS instead of
 * deleting (returned as an unshared chain for the caller's raw write +
 * rebuild), and a consumed container replaces its own endpoint/descendant
 * splices with one unit delete.
 */
function collectDeletionPlan(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endpointPaths: number[][],
	wall: EndWall | null,
	sharing: SharingState
): DeletionPlan {
	const between = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const chromeClearPath = wall && !wall.consumed ? [...wall.container.path, 0] : null;
	let chromeClearChain: CstNode[] | null = null;
	let candidates: number[][] = [];
	for (const p of between) {
		if (chromeClearPath && pathsEqual(p, chromeClearPath)) {
			const chain = ensureUnsharedPath(doc, p, sharing);
			if (chain.length === p.length) chromeClearChain = chain;
		} else {
			candidates.push(p);
		}
	}
	candidates.push(...endpointPaths);
	if (wall?.consumed) {
		candidates = candidates.filter((p) => !pathHasPrefix(p, wall.container.path));
		candidates.push(wall.container.path.slice());
	}
	return { deletionPaths: filterToSubtreeRoots(candidates), chromeClearChain, sharing };
}

/**
 * Plan the deletion — covered subtree roots plus caller-marked endpoint paths
 * (via {@link collectDeletionPlan}) — then own every deletion path's parent
 * spine before any splice (G1.9) and resolve the LCA cascade cleanup stops at.
 * The caller resolves `wall` itself: its `consumed` flag also gates each case's
 * endpoint prose-replace, which runs before this on some cases.
 */
export function planCrossBlockDeletion(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	endpointPaths: number[][],
	wall: EndWall | null,
	sharing: SharingState
): { plan: DeletionPlan; lcaPath: number[] } {
	const plan = collectDeletionPlan(doc, start, end, endpointPaths, wall, sharing);
	for (const path of plan.deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}
	return { plan, lcaPath: lowestCommonAncestor(start.path, end.path) };
}

/**
 * Apply the plan as one atomic step: clear a surviving end container's covered
 * chrome (raw write, never a node delete), then splice the covered subtrees in
 * reverse doc order under the identity gate. The cases sequence their endpoint
 * prose-replace before or after this call per their ordering comments.
 */
export function applyPlannedDeletion(doc: Document, plan: DeletionPlan, lcaPath: number[]): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, lcaPath, plan.sharing);
}

/**
 * Rebuild every deletion path's surviving ancestry, then the cleared chrome's
 * opener line (chain-based so the re-emit survives the splices). Shared tail of
 * every case's rebuild block; case-specific survivor rebuilds stay at the call
 * site, on their own side of this call.
 */
export function rebuildSharedAncestries(
	doc: Document,
	plan: DeletionPlan,
	sharing: SharingState,
	grammar: GrammarView | undefined
): void {
	for (const path of plan.deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, grammar);
	}
	if (plan.chromeClearChain) rebuildUnsharedChain(doc, plan.chromeClearChain, sharing, grammar);
}
