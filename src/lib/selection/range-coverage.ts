/**
 * What a live range covers, decided once from the document so the delete, the copy and the
 * overlay all read one answer. Every reader takes a `CoveredRange`, and only `coverRange` builds
 * one, so a reader can't be handed a pair that skipped the rule.
 */

import type { DocumentView } from '../core/node-views';
import { normalize, type SelectionPoint } from './primitives';
import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';
import { collapsedContainerHiding } from './path-lookup';
import { pathHasPrefix, pathsEqual, type DocPath } from './path-math';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { isCollapsedContainer, isReservedChromeChild } from '../schema/reserved-chrome';

declare const covered: unique symbol;

/** A live range in document order as every reader must see it: table endpoints snapped to whole
 *  rows, and each closed container the range takes whole named in `wholeUnits`. */
export interface CoveredRange {
	readonly start: SelectionPoint;
	readonly end: SelectionPoint;
	/** Collapsed containers taken whole, outermost only, in document order. */
	readonly wholeUnits: readonly DocPath[];
	readonly [covered]: true;
}

/** A same-path pair (a block held whole, a cell rectangle) is returned as is. A closed title row
 *  the range starts on, or ends on past its first byte, takes its container whole. */
export function coverRange(doc: DocumentView, a: SelectionPoint, b: SelectionPoint): CoveredRange {
	const ordered = normalize({ anchor: a, focus: b });
	if (pathsEqual(ordered.start.path, ordered.end.path)) {
		return sealed(ordered.start, ordered.end, []);
	}
	const { start, end } = snapCrossBlockTableEndpoints(doc, ordered.start, ordered.end);
	const units: DocPath[] = [];
	const startUnit = closedTitleOwner(doc, start.path);
	if (startUnit) units.push(startUnit);
	const endUnit = end.offset > 0 ? closedTitleOwner(doc, end.path) : null;
	if (endUnit) units.push(endUnit);
	return sealed(start, end, units);
}

/** The container in `range.wholeUnits` holding `path`, or null. */
export function unitHolding(range: CoveredRange, path: readonly number[]): DocPath | null {
	return range.wholeUnits.find((unit) => pathHasPrefix(path, unit)) ?? null;
}

// ── Internal ────────────────────────────────────────────────────────────────

function sealed(start: SelectionPoint, end: SelectionPoint, wholeUnits: DocPath[]): CoveredRange {
	return { start, end, wholeUnits } as unknown as CoveredRange;
}

/** The collapsed container whose title row `path` is; null for a row inside another container's
 *  hidden body, since the range already covers what follows it. */
function closedTitleOwner(doc: DocumentView, path: readonly number[]): DocPath | null {
	if (path.length < 2) return null;
	const ownerPath = path.slice(0, -1);
	const owner = nodeAt(doc, ownerPath);
	if (!owner || !isBlockNode(owner)) return null;
	if (!isReservedChromeChild(owner, path[path.length - 1]) || !isCollapsedContainer(owner)) {
		return null;
	}
	return collapsedContainerHiding(doc, ownerPath) ? null : docPathFrom(ownerPath);
}
