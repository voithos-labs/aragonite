/**
 * The deletion steps every `rangeDelete` branch (plain, title-line, table) shares: covered
 * paths are spliced out in reverse document order, each only while it still holds the node
 * captured up front, then emptied ancestors are cleaned up. The wall branches also reduce the
 * covered paths to subtree roots, so a container leaves as one splice with its children intact
 * and the undo entry holds a whole detached node.
 */

import type { GrammarView } from '../schema/block-openers';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
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

/**
 * Deletes in reverse document order, each path only while it still holds the node captured up
 * front: a deeper delete plus cleanup can shift a survivor into an outer position. The caller
 * must have copied every parent chain before calling, so the identity check compares the
 * copies (G1.9).
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

/** What a text truncation needs from live mode; the mode is undefined outside it. */
export interface LiveSeamContext {
	presentationMode: PresentationMode | undefined;
	linkRef: InlineResolverRef;
}

/**
 * A truncation in a wall branch is half a join: the delimiter runs it leaves unpaired are bytes
 * the user never saw in live mode, so the kept text side goes through the same cleanup a join
 * does, as a join with the block's own edge (live-mode.md § 4.5). Identity outside live mode.
 * A title line's raw write never comes here; it stays byte for byte.
 */
function cleanTruncatedProse(
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
 * Reparses the bytes that survive at an endpoint's position, through the source kind's own
 * write rule first: the reparse derives metadata from bytes, so anything the truncation dropped
 * and the rule restores (a fence closer) has to be back before it runs. The position's leading
 * blank lines carry over, and an empty slice gives a bare paragraph on the source block's line
 * ending, else the document's (`ending`).
 */
export function reparseTruncatedEndpoint(
	node: CstNode,
	slice: string,
	ending: LineEnding,
	grammar: GrammarView | undefined
): CstNode[] {
	const lineEnding = trailingLineEnding(node.raw, ending);
	const reparsed = parse(normalizeOwnRaw(node, slice, ending) || lineEnding, {
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

/**
 * Installs an endpoint's replacement, marked as the live tree's own copy. `replaceAtPath` fixes
 * up the blank lines a truncation left around the position (G2.13).
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

/**
 * Truncates the start endpoint in place, after the planned deletion. A title line keeps its
 * bytes as they are, by a raw write; a text head goes through the unpaired-run cleanup and is
 * reinstalled by reparse. Returns the offset the collapsed caret lands on. `isChrome` is read
 * by the caller before any splice moved the tree.
 */
export function truncateStartInPlace(
	doc: Document,
	start: SelectionPoint,
	startBlock: CstNode,
	isChrome: boolean,
	live: LiveSeamContext,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	tag: string
): number {
	const cut = charOffsetOf(start, tag);
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(startBlock.raw, ending);
	const head = isChrome
		? { raw: startBlock.raw.slice(0, cut), seam: cut }
		: cleanTruncatedProse(startBlock, 'head', cut, live);
	if (isChrome) {
		startBlock.raw = terminateLine(head.raw, lineEnding);
	} else {
		installTruncatedEndpoint(
			doc,
			start.path,
			reparseTruncatedEndpoint(startBlock, terminateLine(head.raw, lineEnding), ending, grammar),
			sharing
		);
	}
	return head.seam;
}

/**
 * Truncates the end endpoint in place, before the planned deletion, while its path is still
 * valid: a title line by raw write, text through the cleanup and reparse. Returns the surviving
 * tail node re-read through the tree (design rule 5) for a caller that must find it after the
 * splices.
 */
export function truncateEndInPlace(
	doc: Document,
	end: SelectionPoint,
	endBlock: CstNode,
	isChrome: boolean,
	live: LiveSeamContext,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	tag: string
): CstNode | null {
	const cut = charOffsetOf(end, tag);
	if (isChrome) {
		endBlock.raw =
			endBlock.raw.slice(cut) || trailingLineEnding(endBlock.raw, documentLineEnding(doc));
		return endBlock;
	}
	const tail = cleanTruncatedProse(endBlock, 'tail', cut, live).raw;
	installTruncatedEndpoint(
		doc,
		end.path,
		reparseTruncatedEndpoint(endBlock, tail, documentLineEnding(doc), grammar),
		sharing
	);
	return blockNodeAt(doc, end.path);
}

// ── Cross-block deletion plan (title-line and table branches) ───────────────
// The branches interleave endpoint truncation with applyPlannedDeletion differently (end
// before, start after), so the truncation atoms take their call position from the caller.

export interface EndWall {
	container: ChromeContainer;
	consumed: boolean;
}

/**
 * The title-line container holding the end point, when the range enters it from outside.
 * `consumed` means the whole subtree is covered (a text end at the last byte, or an emptied
 * table at the end of the container's last-child chain), so the container is deleted as one
 * unit.
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
	/** The sharing state the plan was collected against; the apply step's splices copy their
	 *  chains through it, so no branch has to pass it again. */
	sharing: SharingState;
}

/**
 * The covered subtree roots plus the endpoint paths the caller marks for removal, honouring
 * the wall: a surviving end container's covered title line is cleared rather than deleted
 * (returned as a copied chain for the caller's raw write), and a consumed container becomes
 * one unit delete.
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
 * Plans the deletion through {@link collectDeletionPlan}, copies every deletion path's parent
 * chain before any splice (G1.9), and finds the common ancestor the cleanup stops at. The
 * caller resolves `wall` itself, since its `consumed` flag also decides each branch's endpoint
 * truncation.
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
 * Applies the plan: clears a surviving end container's covered title line (a raw write, never
 * a node delete), then splices the covered subtrees in reverse document order with the
 * identity check.
 */
export function applyPlannedDeletion(doc: Document, plan: DeletionPlan, lcaPath: number[]): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, lcaPath, plan.sharing);
}

/**
 * Rebuilds every deletion path's surviving ancestors, then the cleared title line's opener
 * (through the saved chain, so the rebuild survives the splices). Branch-specific rebuilds stay
 * at their call sites.
 */
export function rebuildSharedAncestries(
	doc: Document,
	plan: DeletionPlan,
	sharing: SharingState,
	grammar: GrammarView | undefined
): void {
	for (const path of plan.deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, null, grammar);
	}
	if (plan.chromeClearChain)
		rebuildUnsharedChain(doc, plan.chromeClearChain, sharing, null, grammar);
}
