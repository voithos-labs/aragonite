/**
 * The deletion steps every `rangeDelete` branch (plain, title-line, table) shares: covered paths
 * are spliced out in reverse document order, each only while it still holds the node captured up
 * front, then emptied ancestors are cleaned up. The title-line and table branches splice a covered
 * container as one subtree root, so the undo entry holds a whole detached node.
 */

import type { GrammarView } from '../schema/block-openers';
import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { readBlocks } from '../core/parser';
import {
	displayLength,
	documentLineEnding,
	terminateLine,
	trailingLineEnding,
	type LineEnding
} from '../core/lines';
import { charOffsetOf, walkBetween } from './primitives';
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
	blockNodeAt,
	emptyParagraph,
	nodeAt,
	normalizeOwnRaw
} from '../tree-operations/node-primitives';
import { cleanJoinedRaw } from '../tree-operations/node-ops';
import { cutBeforeSuffix } from '../tree-operations/structural-suffix';
import { structuralSuffix } from '../core/inline';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedAncestry, rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
// The title-line branch imports this module back; the cycle is only inside function bodies,
// resolved at call time, so it is safe.
import {
	nearestChromeContainer,
	rangeConsumesContainer,
	lastChildDescendant,
	type ChromeContainer
} from './range-delete-chrome';

/** Subtree roots only: one splice per covered subtree, never a child-by-child emptying. */
function filterToSubtreeRoots(paths: number[][]): number[][] {
	return paths.filter((p) => !paths.some((q) => isStrictAncestorOf(q, p)));
}

/** Deletes in reverse order, each path only while it holds its captured node (cleanup can move a
 *  survivor there); the caller copies parent chains first so the check compares copies (G1.9). */
export function deleteSubtreesIdentityGated(
	doc: Document,
	deletionPaths: number[][],
	lcaPath: number[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const reverseSortedIndices = deletionPaths
		.map((_, i) => i)
		.sort((a, b) => comparePaths(deletionPaths[b], deletionPaths[a]));
	for (const i of reverseSortedIndices) {
		const path = deletionPaths[i];
		if (nodeAt(doc, path) === targetNodes[i]) {
			deleteAtPath(doc, path, sharing, grammar);
			cascadeCleanupEmptyAncestors(doc, path, lcaPath, sharing, grammar);
		}
	}
}

/** A truncation is half a join, so in live mode the kept text drops unpaired delimiter runs:
 *  `docs/design/live-mode.md` § 4.5 Joins clean up where they meet. */
function cleanTruncatedProse(
	node: CstNode,
	kept: 'head' | 'tail',
	cut: number,
	reading: Reading
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
	return cleanJoinedRaw({ ...join, reading });
}

/** Reparses the bytes that survive at an endpoint, through the source kind's write rule first,
 *  so what the rule restores (a fence closer) is back before the reparse derives metadata. */
export function reparseTruncatedEndpoint(
	node: CstNode,
	slice: string,
	ending: LineEnding,
	grammar: GrammarView
): CstNode[] {
	const lineEnding = trailingLineEnding(node.raw, ending);
	const reparsed = readBlocks(normalizeOwnRaw(node, slice, ending) || lineEnding, {
		grammar,
		scope: 'fragment'
	});
	if (reparsed.children.length === 0) {
		return [emptyParagraph(node.leadingTrivia, lineEnding)];
	}
	const cloned = reparsed.children.slice();
	cloned[0] = { ...cloned[0], leadingTrivia: node.leadingTrivia };
	// The trailing blank line the parser split off has no following block to attach to here, so
	// it stays in raw.
	cloned[cloned.length - 1].raw += reparsed.suffix;
	return cloned;
}

/** Installs an endpoint's replacement as the live tree's own copy; `replaceAtPath` fixes the blank
 *  lines around it so the tree reparses to the same block shape (G2.13). */
export function installTruncatedEndpoint(
	doc: Document,
	path: number[],
	replacement: CstNode[],
	sharing: SharingState,
	grammar: GrammarView
): void {
	for (const node of replacement) sharing.stamp(node);
	replaceAtPath(doc, path, replacement, sharing, grammar);
}

/** Truncates the start endpoint in place, after the planned deletion, and returns the caret's
 *  offset. `isChrome` must be read before any splice moved the tree. */
export function truncateStartInPlace(
	doc: Document,
	start: SelectionPoint,
	startBlock: CstNode,
	isChrome: boolean,
	reading: Reading,
	sharing: SharingState,
	grammar: GrammarView,
	tag: string
): number {
	const cut = charOffsetOf(start, tag);
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(startBlock.raw, ending);
	if (isChrome) {
		startBlock.raw = terminateLine(startBlock.raw.slice(0, cut), lineEnding);
		return cut;
	}
	// The kept head keeps the block's structure after it (a setext underline), as a join does.
	const head = cleanTruncatedProse(startBlock, 'head', cutBeforeSuffix(startBlock, cut), reading);
	const kept = terminateLine(head.raw + structuralSuffix(startBlock), lineEnding);
	installTruncatedEndpoint(
		doc,
		start.path,
		reparseTruncatedEndpoint(startBlock, kept, ending, grammar),
		sharing,
		grammar
	);
	return head.seam;
}

/** Truncates the end endpoint in place, before the planned deletion while its path is valid,
 *  and returns the surviving tail as re-read through the tree, never the raw copy. */
export function truncateEndInPlace(
	doc: Document,
	end: SelectionPoint,
	endBlock: CstNode,
	isChrome: boolean,
	reading: Reading,
	sharing: SharingState,
	grammar: GrammarView,
	tag: string
): CstNode | null {
	const cut = charOffsetOf(end, tag);
	if (isChrome) {
		endBlock.raw =
			endBlock.raw.slice(cut) || trailingLineEnding(endBlock.raw, documentLineEnding(doc));
		return endBlock;
	}
	const tail = cleanTruncatedProse(endBlock, 'tail', cut, reading).raw;
	installTruncatedEndpoint(
		doc,
		end.path,
		reparseTruncatedEndpoint(endBlock, tail, documentLineEnding(doc), grammar),
		sharing,
		grammar
	);
	return blockNodeAt(doc, end.path);
}

// ── Cross-block deletion plan (title-line and table branches) ───────────────
// The branches interleave endpoint truncation with applyPlannedDeletion differently (end
// before, start after), so each truncation step takes its call position from the caller.

export interface EndWall {
	container: ChromeContainer;
	consumed: boolean;
}

/** The title-line container holding the end point when the range enters it from outside;
 *  `consumed` means the range covers its whole subtree, so it is deleted as one unit. */
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
	/** The sharing state the plan was collected against; the apply step's splices copy their
	 *  chains through it, so no branch has to pass it again. */
	sharing: SharingState;
}

/** The covered subtree roots plus the caller's endpoint paths. A surviving end container's
 *  covered title line is cleared rather than deleted; a consumed one is deleted whole. */
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

/** Plans the deletion, copying each parent chain first so no splice writes through a node undo
 *  shares (G1.9). The caller resolves `wall`, whose `consumed` flag also decides truncation. */
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

/** Applies the plan: clears a surviving end container's covered title line (a raw write, never a
 *  node delete), then splices the covered subtrees. */
export function applyPlannedDeletion(
	doc: Document,
	plan: DeletionPlan,
	lcaPath: number[],
	grammar: GrammarView
): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, lcaPath, plan.sharing, grammar);
}

/** Rebuilds every deletion path's surviving ancestors, then the cleared title line's opener
 *  through the saved chain, so the rebuild survives the splices. */
export function rebuildSharedAncestries(
	doc: Document,
	plan: DeletionPlan,
	sharing: SharingState,
	grammar: GrammarView
): void {
	for (const path of plan.deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, null, grammar);
	}
	if (plan.chromeClearChain)
		rebuildUnsharedChain(doc, plan.chromeClearChain, sharing, null, grammar);
}
