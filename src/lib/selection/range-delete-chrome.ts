/**
 * The `rangeDelete` branch for a container with a `reservedChrome` child (a details block's
 * summary line): nothing merges across such a container's edge. A covered title line is cleared,
 * not deleted, so the title leaf stays at child 0 (G1.14); the container goes as one splice only
 * when the range covers its whole subtree or takes it whole (`CoveredRange.wholeUnits`).
 */

import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { CoveredRange } from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength, documentLineEnding } from '../core/lines';
import { comparePaths, pathsEqual } from './path-math';
import {
	resolveEndWall,
	planCrossBlockDeletion,
	applyPlannedDeletion,
	truncateEndInPlace,
	truncateStartInPlace
} from './range-delete-ceremony';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import { deleteAtPath } from '../tree-operations/path-mutate';
import { blockNodeAt, emptyParagraph } from '../tree-operations/node-primitives';
import { reservedChromeKindOf, isReservedChromeChild } from '../schema/reserved-chrome';
import { CURSOR_START } from '../block-component';
import { survivorAfterRemoval } from './caret-target';

// ── Public API ──────────────────────────────────────────────────────────────

/** Whether the range takes the title-line branch: an endpoint sits inside a `reservedChrome`
 *  container the range crosses into or out of, or the range starts on the title line itself. */
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

/** Deletes what `range` covers with nothing merging across a title-line container's edge; a
 *  container the range takes whole goes as one splice. */
export function chromeAwareRangeDelete(
	doc: Document,
	range: CoveredRange,
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const { grammar } = reading;
	const { start, end } = range;
	const startC = nearestChromeContainer(doc, start.path);
	const endC = nearestChromeContainer(doc, end.path);
	const startTaken = range.unitHolding(start.path);

	// Copy every chain that will be written before node identities are captured: chains stay
	// valid across splices, paths do not (G1.9).
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const endChain = ensureUnsharedPath(doc, end.path, sharing);

	// `resolveEndWall` is null when the start sits inside the end container, which needs no
	// title-line clear, since that container's child 0 is never strictly between the endpoints.
	const wall = resolveEndWall(doc, range, null);
	const endConsumed = wall?.consumed ?? false;
	const { plan, lcaPath } = planCrossBlockDeletion(doc, range, [], wall, sharing);

	// The end truncates first, while its path is still valid, and its tail never merges into
	// the start. Skipped when its container goes whole.
	if (!endConsumed) {
		truncateEndInPlace(
			doc,
			end,
			endChain[endChain.length - 1],
			endC !== null && isChromeChild(endC, end.path),
			reading,
			sharing,
			'chromeAwareRangeDelete:end'
		);
	}

	applyPlannedDeletion(doc, plan, lcaPath, grammar);

	// Start truncates in place; every deletion sits after it in doc order, so start.path is
	// still live. A start whose container went whole has nothing left to truncate.
	const seam = startTaken
		? null
		: truncateStartInPlace(
				doc,
				start,
				startChain[startChain.length - 1],
				startC !== null && isChromeChild(startC, start.path),
				reading,
				sharing,
				'chromeAwareRangeDelete:start'
			);

	// Chain-based rebuilds: node references survive the splices above where paths may not, and
	// every touched container re-emits raw (G1.12). A removed start container is left out.
	const liveStartChain = startTaken ? startChain.slice(0, startTaken.length - 1) : startChain;
	rebuildUnsharedChain(doc, liveStartChain, sharing, null, grammar);
	rebuildUnsharedChain(doc, endChain, sharing, null, grammar);

	const collapsedCaret = startTaken
		? caretWhereRemoved(doc, startTaken, sharing)
		: { path: start.path.slice(), offset: seam ?? 0 };
	return { newDoc: doc, collapsedCaret };
}

// ── A container taken whole ─────────────────────────────────────────────────

/** A range wholly inside one container it takes whole, its title row included: one splice. */
export function removeWhole(
	doc: Document,
	path: number[],
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const chain = ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	deleteAtPath(doc, path, sharing, reading.grammar);
	if (chain.length > 0) rebuildUnsharedChain(doc, chain, sharing, null, reading.grammar);
	return { newDoc: doc, collapsedCaret: caretWhereRemoved(doc, path, sharing) };
}

/** The start of what now follows the removed block, else the end of what precedes it; an
 *  emptied document gets the blank paragraph every document keeps. */
export function caretWhereRemoved(
	doc: Document,
	path: number[],
	sharing: SharingState
): SelectionPoint {
	const survivor = survivorAfterRemoval(doc, path, 'after');
	if (!survivor) {
		const filler = emptyParagraph('', documentLineEnding(doc));
		sharing.stamp(filler);
		doc.children.push(filler);
		return { path: [0], offset: 0 };
	}
	const leaf = blockNodeAt(doc, survivor.path);
	const offset = survivor.offset === CURSOR_START || !leaf ? 0 : displayLength(leaf.raw);
	return { path: [...survivor.path], offset };
}

// ── Wall primitives (shared with the table branch) ──────────────────────────
// `involvesTable` is checked before `involvesReservedChrome`, so a range with a table endpoint
// goes to `range-delete-table.ts`; these helpers keep the no-merge rule in one place for both.

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
