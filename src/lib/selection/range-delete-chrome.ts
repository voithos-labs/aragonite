/**
 * The `rangeDelete` branch for a container with a `reservedChrome` child (a details block's
 * summary line), the wall rule: nothing merges across such a container's edge. Endpoints
 * outside it truncate in place, a covered title line is cleared rather than deleted (G1.14),
 * covered body children are deleted, and the container itself goes only when the range covers
 * its whole subtree, then as one splice with its children intact.
 */

import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import type { SharingState } from '../tree-operations/sharing';
import { displayLength } from '../core/lines';
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
import { reservedChromeKindOf, isReservedChromeChild } from '../schema/reserved-chrome';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * True when the range must take the wall branch: an endpoint sits inside a `reservedChrome`
 * container the range crosses out of or into, or the range starts in the title line itself.
 * Same-block, body-only, and enclose-from-outside ranges stay on the plain branch.
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
 * Deletes [start, end] under the wall rule. Both endpoints truncate in place (a title line by a
 * raw write, which keeps the kind through `contextDependentKind`; text by a reparse of the
 * surviving slice), and nothing merges across the wall. The collapsed caret lands at the start,
 * as in the plain branch.
 */
export function chromeAwareRangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState,
	reading: Reading
): RangeDeleteResult {
	const { grammar } = reading;
	const startC = nearestChromeContainer(doc, start.path);
	const endC = nearestChromeContainer(doc, end.path);

	// Copy every chain that will be written before node identities are captured (G1.9): chains
	// stay valid across splices, paths do not.
	const startChain = ensureUnsharedPath(doc, start.path, sharing);
	const endChain = ensureUnsharedPath(doc, end.path, sharing);

	// No endpoint path is marked for deletion: both endpoints truncate in place below.
	// `resolveEndWall` returns null when the start sits inside the end container, which needs
	// no title-line clear either way, since that container's child 0 is never strictly between
	// the endpoints.
	const wall = resolveEndWall(doc, start, end, null);
	const endConsumed = wall?.consumed ?? false;
	const { plan, lcaPath } = planCrossBlockDeletion(doc, start, end, [], wall, sharing);

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
			grammar,
			'chromeAwareRangeDelete:end'
		);
	}

	applyPlannedDeletion(doc, plan, lcaPath, grammar);

	// Start truncates in place; every deletion sits after it in doc order, so start.path is
	// still live.
	const seam = truncateStartInPlace(
		doc,
		start,
		startChain[startChain.length - 1],
		startC !== null && isChromeChild(startC, start.path),
		reading,
		sharing,
		grammar,
		'chromeAwareRangeDelete:start'
	);

	// Chain-based rebuilds: node references survive the splices above where paths may not, and
	// every touched container re-emits raw (G1.12).
	rebuildUnsharedChain(doc, startChain, sharing, null, grammar);
	rebuildUnsharedChain(doc, endChain, sharing, null, grammar);

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: seam }
	};
}

// ── Wall primitives (shared with the table branch) ──────────────────────────
// `involvesTable` is checked before `involvesReservedChrome`, so a range with a table endpoint
// goes to `range-delete-table.ts`; these helpers keep the wall rule in one place for both.

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
