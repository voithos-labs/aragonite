/**
 * Reserved-chrome branch of rangeDelete, the wall rule: nothing merges across a
 * `reservedChrome` container's wall. Outside endpoints truncate in place, covered chrome clears
 * (never node-deletes, G1.14), covered body children delete, and the container dies only when
 * the range consumes its whole subtree, then as ONE splice with children intact.
 */

import type { GrammarView } from '../schema/block-openers';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { displayLength, terminateLine, trailingLineEnding } from '../core/lines';
import { charOffsetOf } from './primitives';
import { comparePaths, pathsEqual } from './path-math';
import { replaceAtPath } from '../tree-operations/path-mutate';
import { emptyParagraph, normalizeOwnRaw } from '../tree-operations/node-ops';
import {
	resolveEndWall,
	planCrossBlockDeletion,
	applyPlannedDeletion
} from './range-delete-ceremony';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import { reservedChromeKindOf, isReservedChromeChild } from '../schema/reserved-chrome';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * True when the range must take the wall path: an endpoint sits inside a `reservedChrome`
 * container the range crosses out of or into, or the range starts in the chrome leaf itself.
 * Same-block, body-only, and enclose-from-outside ranges stay on the generic path.
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
 * Delete [start, end] under the wall rule. Both endpoints truncate in place (chrome by a raw
 * write, keeping the kind via contextDependentKind; prose by a reparse of the surviving slice),
 * and nothing merges across the wall. Collapsed caret keeps generic start-position semantics.
 */
export function chromeAwareRangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState,
	grammar: GrammarView | undefined
): RangeDeleteResult {
	const startOffset = charOffsetOf(start, 'chromeAwareRangeDelete:start');
	const endOffset = charOffsetOf(end, 'chromeAwareRangeDelete:end');
	const startC = nearestChromeContainer(doc, start.path);
	const endC = nearestChromeContainer(doc, end.path);

	// Own every written spine BEFORE identities are captured (G1.9): chains stay valid across
	// splices, paths don't.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const endChain = ensureUnsharedPath(doc, end.path, sharing);

	// Shared deletion plan (range-delete-ceremony.ts). Chrome marks no endpoint paths for
	// deletion: both endpoints truncate in place below. resolveEndWall returns null when start
	// sits inside the end container, which needs no chrome-clear either way, since that
	// container's chrome child 0 never lands in the strictly-between walk.
	const wall = resolveEndWall(doc, start, end, null);
	const endConsumed = wall?.consumed ?? false;
	const { plan, lcaPath } = planCrossBlockDeletion(doc, start, end, [], wall, sharing);

	// End truncates in place first (its path is still live), the wall: its tail never merges
	// into start. Skipped when its container dies whole.
	if (!endConsumed) {
		const endBlock = endChain[endChain.length - 1];
		const endTail = endBlock.raw.slice(endOffset);
		if (endC && isChromeChild(endC, end.path)) {
			endBlock.raw = endTail || trailingLineEnding(endBlock.raw);
		} else {
			const tailReplacement = reparseTruncatedEndpoint(endBlock, endTail);
			for (const node of tailReplacement) sharing.stamp(node);
			replaceAtPath(doc, end.path, tailReplacement);
		}
	}

	applyPlannedDeletion(doc, plan, lcaPath);

	// Start truncates in place; every deletion sits after it in doc order, so start.path is
	// still live.
	const startBlock = startChain[startChain.length - 1];
	const startHead = startBlock.raw.slice(0, startOffset);
	if (startC && isChromeChild(startC, start.path)) {
		startBlock.raw = terminateLine(startHead, startBlock.raw);
	} else {
		const headReplacement = reparseTruncatedEndpoint(
			startBlock,
			terminateLine(startHead, startBlock.raw)
		);
		for (const node of headReplacement) sharing.stamp(node);
		replaceAtPath(doc, start.path, headReplacement);
	}

	// Chain-based rebuilds: node references survive the splices above where paths may not, and
	// every touched container re-emits raw (G1.12).
	rebuildUnsharedChain(doc, startChain, sharing, grammar);
	rebuildUnsharedChain(doc, endChain, sharing, grammar);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: startOffset }
	};
}

// ── Wall primitives (shared with the table branch) ──────────────────────────
// `involvesTable` dispatches before `involvesReservedChrome`, so ranges with a table endpoint
// ride range-delete-table.ts; these primitives keep the wall rule single-sourced across both.

export interface ChromeContainer {
	path: number[];
	node: CstNode;
}

/** Deepest strict ancestor of `path` whose kind declares reservedChrome. */
export function nearestChromeContainer(doc: Document, path: number[]): ChromeContainer | null {
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

export function isChromeChild(container: ChromeContainer, leafPath: number[]): boolean {
	return (
		leafPath.length === container.path.length + 1 &&
		isReservedChromeChild(container.node, leafPath[container.path.length])
	);
}

/**
 * The range's end lands on the container's last byte: every step from the container is a
 * last-child edge and the offset consumes the block's visible text.
 */
export function rangeConsumesContainer(container: ChromeContainer, end: SelectionPoint): boolean {
	const endNode = lastChildDescendant(container, end.path);
	return endNode !== null && end.offset >= displayLength(endNode.raw);
}

/** The node at `path` when every step from the container is a last-child edge, else null. */
export function lastChildDescendant(container: ChromeContainer, path: number[]): CstNode | null {
	let node: CstNode = container.node;
	for (let i = container.path.length; i < path.length; i++) {
		const children = node.children ?? [];
		if (path[i] !== children.length - 1) return null;
		node = children[path[i]];
	}
	return node;
}

/**
 * Reparse a truncated endpoint's surviving slice, through the source kind's own write rule:
 * the reparse re-derives metadata from bytes, so structure the truncation dropped and the rule
 * restores (a fence closer) has to land before it. Leading trivia is preserved and an empty
 * slice gives a bare paragraph, on the source block's line ending (G4.20).
 */
export function reparseTruncatedEndpoint(node: CstNode, slice: string): CstNode[] {
	const lineEnding = trailingLineEnding(node.raw);
	const reparsed = parse(normalizeOwnRaw(node, slice) || lineEnding, { scope: 'fragment' });
	if (reparsed.children.length === 0) {
		return [emptyParagraph(node.leadingTrivia, lineEnding)];
	}
	const cloned = reparsed.children.slice();
	cloned[0] = { ...cloned[0], leadingTrivia: node.leadingTrivia };
	return cloned;
}
