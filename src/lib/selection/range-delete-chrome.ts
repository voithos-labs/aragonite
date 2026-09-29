/**
 * The `rangeDelete` branch where nothing merges: an endpoint in a container with a title row (a
 * details block's summary line) the range crosses, or an edge the range holds whole. Each kept edge
 * is truncated in place. A covered title line is cleared, not deleted, so the title leaf stays at
 * child 0 (G1.14).
 */

import type { Reading } from '../schema/reading';
import type { Document } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
import type { CaretPosition, SelectionPoint } from './primitives';
import type { RangeDeleteResult } from './range-delete';
import { isChromeChild, nearestChromeContainer, type RangeCoverage } from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import { comparePaths, pathsEqual } from './path-math';
import {
	planCrossBlockDeletion,
	applyPlannedDeletion,
	rebuildSharedAncestries,
	truncateEndInPlace,
	truncateStartInPlace
} from './range-delete-ceremony';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import {
	caretPointFor,
	survivorAfterRemoval,
	survivorWhereRangeResumes,
	type RemovalGesture
} from './caret-target';

// ── Public API ──────────────────────────────────────────────────────────────

/** Whether an endpoint sits inside a title-line container the range crosses into or out of, or
 *  the range starts on the title line itself. */
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

/** Deletes what the range covers with no merge: removes what it holds whole and truncates each kept
 *  edge in place. `gesture` lands the caret when the range keeps neither edge. */
export function unjoinedRangeDelete(
	doc: Document,
	coverage: RangeCoverage,
	sharing: SharingState,
	reading: Reading,
	gesture: RemovalGesture
): RangeDeleteResult {
	const { grammar } = reading;
	const { start, end } = coverage.range;
	const { startEdge, endEdge } = coverage;

	// Copy every chain that will be written before node identities are captured: chains stay
	// valid across splices, paths do not (G1.9).
	const startChain = startEdge ? ensureUnsharedPath(doc, start.path, sharing) : null;
	const endChain = endEdge ? ensureUnsharedPath(doc, end.path, sharing) : null;
	const plan = planCrossBlockDeletion(doc, coverage, [], sharing);

	// The end truncates first, while its path is still valid.
	if (endChain) {
		const endC = nearestChromeContainer(doc, end.path);
		truncateEndInPlace(
			doc,
			end,
			endChain[endChain.length - 1],
			endC !== null && isChromeChild(endC, end.path),
			reading,
			sharing,
			'unjoinedRangeDelete:end'
		);
	}

	applyPlannedDeletion(doc, plan, grammar);

	// Every deletion sits after the start in document order, so its path is still live.
	const startC = nearestChromeContainer(doc, start.path);
	const seam = startChain
		? truncateStartInPlace(
				doc,
				start,
				startChain[startChain.length - 1],
				startC !== null && isChromeChild(startC, start.path),
				reading,
				sharing,
				'unjoinedRangeDelete:start'
			)
		: null;

	// Chain-based rebuilds: node references survive the splices above where paths may not, and
	// every touched container re-emits raw (G1.12).
	if (startChain) rebuildUnsharedChain(doc, startChain, sharing, null, grammar);
	if (endChain) rebuildUnsharedChain(doc, endChain, sharing, null, grammar);
	rebuildSharedAncestries(doc, plan, sharing, grammar);

	if (seam !== null) {
		const joinAt = { path: start.path.slice(), offset: seam };
		return { newDoc: doc, caret: () => joinAt };
	}
	const first = coverage.wholeRoots[0];
	return {
		newDoc: doc,
		caret: endEdge
			? (committed) => caretWhereRangeResumes(committed, coverage.rootHolding(start.path) ?? first)
			: (committed) => caretWhereRemoved(committed, first, gesture)
	};
}

/** The caret once the block at `path` went, on the side `gesture` points; read on the committed
 *  tree, which holds the block the commit gives an emptied document. */
export function caretWhereRemoved(
	committed: DocumentView,
	path: number[],
	gesture: RemovalGesture
): SelectionPoint | null {
	return caretAt(committed, survivorAfterRemoval(committed, path, gesture));
}

/** The caret once a range took the block at `path` whole and ran on: where what's left of the
 *  range's end begins, read on the committed tree. */
export function caretWhereRangeResumes(
	committed: DocumentView,
	path: number[]
): SelectionPoint | null {
	return caretAt(committed, survivorWhereRangeResumes(committed, path));
}

function caretAt(committed: DocumentView, survivor: CaretPosition | null): SelectionPoint | null {
	return survivor && caretPointFor(committed, survivor);
}
