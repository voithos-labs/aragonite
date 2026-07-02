/**
 * Reserved-chrome branch of rangeDelete — the wall rule: nothing merges across
 * a `reservedChrome` container's wall. Outside endpoints truncate in place,
 * covered chrome clears (never node-deletes, G1.14), covered body children
 * delete, and the container dies only when the range consumes its whole
 * subtree — then as ONE splice with children intact, so a commit scope holding
 * the detached node stays invariant-clean.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { displayLength } from '../core/lines';
import { walkBetween, comparePaths, assertCharOffset } from './primitives';
import {
	isPathSubtreeBetween,
	isStrictAncestorOf,
	lowestCommonAncestor,
	pathHasPrefix,
	pathsEqual
} from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
import { nodeAt } from '../tree-operations/node-ops';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import { reservedChromeKindOf, isReservedChromeChild } from '../schema/reserved-chrome';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * True when the range must take the wall path: an endpoint sits inside a
 * `reservedChrome` container the range crosses out of (or into), or the range
 * starts in the chrome leaf itself. Ranges the generic path already handles
 * safely stay generic: same-block ranges (in-place raw merge, kind kept),
 * body-only ranges inside one container, and ranges enclosing a container from
 * strictly outside (deleted whole as an ordinary between subtree).
 */
export function involvesReservedChrome(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint
): boolean {
	if (comparePaths(start.path, end.path) === 0) return false;
	const startC = nearestChromeContainer(doc, start.path);
	const endC = nearestChromeContainer(doc, end.path);
	if (!startC && !endC) return false;
	if (startC && endC && pathsEqual(startC.path, endC.path)) {
		return isChromeChild(startC, start.path);
	}
	return true;
}

/**
 * Delete [start, end] under the wall rule. Both endpoints truncate in place —
 * chrome endpoints by a raw write (kind kept via contextDependentKind), prose
 * endpoints by a reparse of their surviving slice — and nothing merges across
 * the wall. Collapsed caret keeps the generic start-position semantics.
 */
export function chromeAwareRangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState
): RangeDeleteResult {
	const startOffset = assertCharOffset(start, 'chromeAwareRangeDelete:start');
	const endOffset = assertCharOffset(end, 'chromeAwareRangeDelete:end');
	const startC = nearestChromeContainer(doc, start.path);
	const endC = nearestChromeContainer(doc, end.path);
	const endConsumed =
		endC !== null && !pathHasPrefix(start.path, endC.path) && rangeConsumesContainer(endC, end);

	// Own every written spine BEFORE identities are captured (G1.9; see the
	// range-delete.ts ceremony) — chains stay valid across splices, paths don't.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const endChain = ensureUnsharedPath(doc, end.path, sharing);

	const between = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);

	// A surviving end container's covered chrome (its child 0 sits strictly
	// between the endpoints) clears instead of deleting.
	const chromeClearPath = endC && !endConsumed ? [...endC.path, 0] : null;
	const clearTargets: CstNode[] = [];
	let deletionCandidates: number[][] = [];
	for (const p of between) {
		if (chromeClearPath && pathsEqual(p, chromeClearPath)) {
			const chain = ensureUnsharedPath(doc, p, sharing);
			if (chain.length === p.length) clearTargets.push(chain[chain.length - 1]);
		} else {
			deletionCandidates.push(p);
		}
	}
	if (endConsumed) {
		deletionCandidates = deletionCandidates.filter((p) => !pathHasPrefix(p, endC.path));
		deletionCandidates.push(endC.path.slice());
	}
	// Subtree roots only: one splice per covered subtree, never a child-by-child
	// emptying of a container that is about to die.
	const deletionPaths = deletionCandidates.filter(
		(p) => !deletionCandidates.some((q) => isStrictAncestorOf(q, p))
	);

	for (const p of deletionPaths) ensureUnsharedPath(doc, p.slice(0, -1), sharing);
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// End truncates in place first (its path is still live) — the wall: its
	// tail never merges into start. Skipped when its container dies whole.
	if (!endConsumed) {
		const endBlock = endChain[endChain.length - 1];
		const endTail = endBlock.raw.slice(endOffset);
		if (endC && isChromeChild(endC, end.path)) {
			endBlock.raw = endTail || lineEndingOf(endBlock.raw);
		} else {
			const tailReplacement = reparseWithFallback(
				endTail || lineEndingOf(endBlock.raw),
				endBlock.leadingTrivia
			);
			for (const node of tailReplacement) sharing.stamp(node);
			replaceAtPath(doc, end.path, tailReplacement);
		}
	}

	for (const chrome of clearTargets) chrome.raw = '\n';

	// Identity-gated reverse-doc-order deletion: a deeper delete + cascade can
	// shift a survivor into an outer slot (see range-delete.ts).
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

	// Start truncates in place; every deletion sits after it in doc order, so
	// start.path is still live.
	const startBlock = startChain[startChain.length - 1];
	const startHead = startBlock.raw.slice(0, startOffset);
	if (startC && isChromeChild(startC, start.path)) {
		startBlock.raw = terminateLine(startHead, startBlock.raw);
	} else {
		const headReplacement = reparseWithFallback(
			terminateLine(startHead, startBlock.raw),
			startBlock.leadingTrivia
		);
		for (const node of headReplacement) sharing.stamp(node);
		replaceAtPath(doc, start.path, headReplacement);
	}

	// Chain-based rebuilds: node references survive the splices above where
	// paths may not — every touched container re-emits raw (G1.12).
	rebuildUnsharedChain(startChain, sharing);
	rebuildUnsharedChain(endChain, sharing);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: startOffset }
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

interface ChromeContainer {
	path: number[];
	node: CstNode;
}

/** Deepest strict ancestor of `path` whose kind declares reservedChrome. */
function nearestChromeContainer(doc: Document, path: number[]): ChromeContainer | null {
	let found: ChromeContainer | null = null;
	let children = doc.children;
	for (let i = 0; i < path.length - 1; i++) {
		const node = children[path[i]];
		if (!node) break;
		if (reservedChromeKindOf(node.kind) !== undefined) {
			found = { path: path.slice(0, i + 1), node };
		}
		children = node.children ?? [];
	}
	return found;
}

function isChromeChild(container: ChromeContainer, leafPath: number[]): boolean {
	return (
		leafPath.length === container.path.length + 1 &&
		isReservedChromeChild(container.node, leafPath[container.path.length])
	);
}

/**
 * The range's end lands on the container's last byte: every step from the
 * container to the end block is a last-child edge and the offset consumes the
 * block's visible text. With start outside, the whole subtree is covered and
 * the container dies as one unit.
 */
function rangeConsumesContainer(container: ChromeContainer, end: SelectionPoint): boolean {
	let node: CstNode = container.node;
	for (let i = container.path.length; i < end.path.length; i++) {
		const children = node.children ?? [];
		if (end.path[i] !== children.length - 1) return false;
		node = children[end.path[i]];
	}
	return end.offset >= displayLength(node.raw);
}

function lineEndingOf(raw: string): string {
	return raw.endsWith('\r\n') ? '\r\n' : '\n';
}

/** A truncated slice standing alone mid-document must stay line-terminated. */
function terminateLine(text: string, sourceRaw: string): string {
	return text.endsWith('\n') ? text : text + lineEndingOf(sourceRaw);
}

function reparseWithFallback(raw: string, leadingTrivia: string): CstNode[] {
	const reparsed = parse(raw || '\n');
	if (reparsed.children.length === 0) {
		return [{ kind: 'paragraph', leadingTrivia, raw: '\n' }];
	}
	const cloned = reparsed.children.slice();
	cloned[0] = { ...cloned[0], leadingTrivia };
	return cloned;
}
