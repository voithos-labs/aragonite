/**
 * The block a range covers whole, for the paste and typing paths that replace it, read off
 * `rangeCoverage`. There is no join inside such a range to merge at: the block leaves the tree, so
 * the new bytes go into its list position rather than at a caret in whatever block took it.
 */

import { pathsEqual } from './path-math';
import type { RangeCoverage } from './range-coverage';

/** The one block both endpoints sit in and the range holds whole, a table included, or null. */
export function blockCoveredWhole(coverage: RangeCoverage): number[] | null {
	const { start, end } = coverage.range;
	if (!pathsEqual(start.path, end.path) || coverage.wholeRoots.length !== 1) return null;
	return coverage.wholeRoots[0].slice();
}
