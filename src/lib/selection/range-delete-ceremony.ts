/**
 * Deletion ceremony shared by every rangeDelete branch (generic, chrome, table): covered paths
 * splice identity-gated in reverse doc order, with cascading empty-ancestor cleanup. The wall
 * branches also reduce covered paths to subtree roots so a container dies as ONE splice with
 * children intact, keeping a commit scope or undo entry holding the detached node clean.
 */

import type { GrammarView } from '../schema/block-openers';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { displayLength, trailingLineEnding } from '../core/lines';
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
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import {
	cleanJoinedRaw,
	emptyParagraph,
	nodeAt,
	normalizeOwnRaw
} from '../tree-operations/node-ops';
import {
	ensureUnsharedPath,
	rebuildUnsharedAncestry,
	rebuildUnsharedChain
} from '../tree-operations/unshare';
// Wall primitives live with the chrome branch, which imports the atoms below back. The
// resulting cycle is function-body-only (resolved at call time, never at module load), so it
// is safe.
import {
	nearestChromeContainer,
	rangeConsumesContainer,
	lastChildDescendant,
	type ChromeContainer
} from './range-delete-chrome';

/** Subtree roots only: one splice per covered subtree, never a child-by-child emptying. */
export function filterToSubtreeRoots(paths: number[][]): number[][] {
	return paths.filter((p) => !paths.some((q) => isStrictAncestorOf(q, p)));
}

/**
 * Identity-gated reverse-doc-order deletion: a deeper delete + cascade can shift a survivor
 * into an outer slot, so each path is re-resolved and spliced only while it still holds the
 * node captured up front. Caller must own every parent spine BEFORE calling (G1.9).
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
			deleteAtPath(doc, path, sharing);
			cascadeCleanupEmptyAncestors(doc, path, lcaPath, sharing);
		}
	}
}

/** The live-seam reads a prose truncation needs; both undefined outside live. */
export interface LiveSeamContext {
	presentationMode: PresentationMode | undefined;
	linkRef: InlineResolverRef | undefined;
}

/**
 * A wall-branch truncation is half a join: the runs it strands, their partner gone with the
 * cut, are bytes the reader never saw, so a kept prose side crosses the registered cleaner
 * (live-mode.md § 4.5), expressed as a join with the block's own edge. Identity outside live;
 * a chrome child's raw write never routes here — the wall stays byte-literal.
 */
export function cleanTruncatedProse(
	node: CstNode,
	kept: 'head' | 'tail',
	cut: number,
	live: LiveSeamContext
): { raw: string; seam: number } {
	const join =
		kept === 'head'
			? {
					mergedRaw: node.raw.slice(0, cut),
					seam: cut,
					start: { node, offset: cut },
					end: { node, offset: displayLength(node.raw) }
				}
			: {
					mergedRaw: node.raw.slice(cut),
					seam: 0,
					start: { node, offset: 0 },
					end: { node, offset: cut }
				};
	return cleanJoinedRaw({ ...join, linkRef: live.linkRef }, live.presentationMode);
}

/**
 * Reparse the bytes surviving at an endpoint's slot, through the source kind's own write rule:
 * the reparse re-derives metadata from bytes, so structure the truncation dropped and the rule
 * restores (a fence closer) has to land before it. The slot's leading trivia rides across, and
 * an empty slice gives a bare paragraph, on the source block's line ending (G4.20).
 */
export function reparseTruncatedEndpoint(node: CstNode, slice: string): CstNode[] {
	const lineEnding = trailingLineEnding(node.raw);
	const reparsed = parse(normalizeOwnRaw(node, slice) || lineEnding, { scope: 'fragment' });
	if (reparsed.children.length === 0) {
		return [emptyParagraph(node.leadingTrivia, lineEnding)];
	}
	const cloned = reparsed.children.slice();
	cloned[0] = { ...cloned[0], leadingTrivia: node.leadingTrivia };
	// The peeled trailing blank line has no follower slot here, so it stays in raw.
	cloned[cloned.length - 1].raw += reparsed.suffix;
	return cloned;
}

/**
 * Install an endpoint's replacement, stamped as the live tree's own. The splice door settles the
 * blank run a truncation left the slot in (G2.13); `sharing` owns the writes.
 */
export function installTruncatedEndpoint(
	doc: Document,
	path: number[],
	replacement: CstNode[],
	sharing: SharingState
): void {
	for (const node of replacement) sharing.stamp(node);
	replaceAtPath(doc, path, replacement, sharing);
}

// ── Cross-block deletion plan (chrome + table branches) ─────────────────────
// The cross-block branches interleave their endpoint replaceAtPath differently, so the steps
// stay separate atoms the callers sequence explicitly.

export interface EndWall {
	container: ChromeContainer;
	consumed: boolean;
}

/**
 * End-side wall context: the chrome container holding the end point, when the range enters it
 * from outside. `consumed` means the whole subtree is covered (a prose end's last-byte rule, or
 * an emptied table on the container's last-child chain), so the container unit-deletes.
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
 * Covered subtree roots plus endpoint paths the caller marks for removal, honoring the chrome
 * wall: a surviving end container's covered chrome CLEARS instead of deleting (returned as an
 * unshared chain for the caller's raw write), and a consumed container becomes one unit delete.
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
 * Plan the deletion via {@link collectDeletionPlan}, own every deletion path's parent spine
 * before any splice (G1.9), and resolve the LCA cascade cleanup stops at. The caller resolves
 * `wall` itself: its `consumed` flag also gates each case's endpoint prose-replace.
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
 * Apply the plan atomically: clear a surviving end container's covered chrome (raw write, never
 * a node delete), then splice the covered subtrees in reverse doc order under the identity gate.
 */
export function applyPlannedDeletion(doc: Document, plan: DeletionPlan, lcaPath: number[]): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, lcaPath, plan.sharing);
}

/**
 * Rebuild every deletion path's surviving ancestry, then the cleared chrome's opener line
 * (chain-based, so the re-emit survives the splices). Case-specific rebuilds stay at call sites.
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
