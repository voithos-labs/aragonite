// A range delete between two points, as the editor's delete runs it: cover the range, read what it
// covers, remove it. Table endpoints must be cell points, as `SelectionState` hands them over.

import type { Document } from '#lib/core/nodes.js';
import type { Reading } from '#lib/schema/reading.js';
import type { ScopeWrites } from '#lib/action-contracts.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import type { RemovalGesture } from '#lib/selection/caret-target.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { rangeDelete, type RangeDeleteResult } from '#lib/selection/range-delete.js';
import { createSharingState, type SharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from './fixture-grammar';
import { writtenBelow } from '#lib/test/harness/settle-funnel.js';

export interface RangeDeleteOptions {
	sharing?: SharingState;
	reading?: Reading;
	gesture?: RemovalGesture;
	/** The document scope of a commit the delete runs inside, which rebuilds what it owned. */
	scope?: ScopeWrites;
}

export function deleteRange(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	{
		sharing = createSharingState(),
		reading = fixtureReading(),
		gesture = 'keyless',
		scope
	}: RangeDeleteOptions = {}
): RangeDeleteResult {
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const remove = (writes: ScopeWrites) => rangeDelete(doc, coverage, writes, reading, gesture);
	return scope ? remove(scope) : writtenBelow(doc, remove, reading.grammar, sharing);
}
