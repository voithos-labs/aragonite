/**
 * The `rangeDelete` branch where nothing merges: an endpoint in a container with a title row (a
 * details block's summary line) the range crosses, or an edge the range holds whole. Each kept edge
 * is truncated in place. A covered title line is cleared, not deleted, so the title leaf stays at
 * child 0 (G1.14).
 */

import type { Reading } from '../../../schema/reading';
import type { Document } from '../../../core/nodes';
import type { DocumentView } from '../../../core/node-views';
import type { CaretPosition, SelectionPoint } from '../../primitives';
import type { RangeDeleteResult } from './range-delete';
import type { RemovalLanding } from '../../removal-landing';
import {
	isChromeChild,
	nearestChromeContainer,
	titleRowOwner,
	type RangeCoverage
} from '../../range-coverage';
import type { ScopeWrites } from '../../../action-contracts';
import { comparePaths, pathsEqual } from '../../path-math';
import {
	planCrossBlockDeletion,
	applyPlannedDeletion,
	renumberAfterDeletion,
	truncateEndInPlace,
	truncateStartInPlace
} from './range-delete-ceremony';
import {
	caretPointFor,
	survivorAfterRemoval,
	survivorWhereRangeResumes,
	type RemovalGesture
} from '../../caret-target';

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
 *  edge in place. The caret goes where `landing` says, beside a removed block on `gesture`'s side. */
export function unjoinedRangeDelete(
	doc: Document,
	coverage: RangeCoverage,
	scope: ScopeWrites,
	reading: Reading,
	gesture: RemovalGesture,
	landing: RemovalLanding
): RangeDeleteResult {
	const { start, end } = coverage.range;
	const { startEdge, endEdge } = coverage;

	// Copy every chain that will be written before node identities are captured: chains stay
	// valid across splices, paths do not (G1.9).
	const startChain = startEdge ? scope.own(start.path) : null;
	const endChain = endEdge ? scope.own(end.path) : null;
	const plan = planCrossBlockDeletion(doc, coverage, [], scope);

	// The end truncates first, while its path is still valid.
	if (endChain) {
		truncateEndInPlace(
			doc,
			end,
			endChain[endChain.length - 1],
			titleRowOwner(doc, end.path),
			reading,
			scope,
			'unjoinedRangeDelete:end'
		);
	}

	applyPlannedDeletion(doc, plan);

	// Every deletion sits after the start in document order, so its path is still live.
	const seam = startChain
		? truncateStartInPlace(
				doc,
				start,
				startChain[startChain.length - 1],
				titleRowOwner(doc, start.path),
				reading,
				scope,
				'unjoinedRangeDelete:start'
			)
		: null;
	renumberAfterDeletion(doc, plan);

	switch (landing.at) {
		case 'resume':
			return { newDoc: doc, caret: (committed) => caretWhereRangeResumes(committed, landing.root) };
		case 'beside':
			return {
				newDoc: doc,
				caret: (committed) => caretWhereRemoved(committed, landing.root, gesture)
			};
		default: {
			const joinAt = { path: start.path.slice(), offset: seam ?? 0 };
			return { newDoc: doc, caret: () => joinAt };
		}
	}
}

/** The caret once the block at `path` went, on the side `gesture` points; read on the committed
 *  tree, which holds the block the commit gives an emptied document. */
function caretWhereRemoved(
	committed: DocumentView,
	path: readonly number[],
	gesture: RemovalGesture
): SelectionPoint | null {
	return caretAt(committed, survivorAfterRemoval(committed, path, gesture));
}

/** The caret once a range took the block at `path` whole and ran on: where what's left of the
 *  range's end begins, read on the committed tree. */
export function caretWhereRangeResumes(
	committed: DocumentView,
	path: readonly number[]
): SelectionPoint | null {
	return caretAt(committed, survivorWhereRangeResumes(committed, path));
}

function caretAt(committed: DocumentView, survivor: CaretPosition | null): SelectionPoint | null {
	return survivor && caretPointFor(committed, survivor);
}
