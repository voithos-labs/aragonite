/**
 * Where the caret lands once a range's removal commits, picked from the coverage before anything
 * moves. The removal builds its caret from this pick, and a command key over the range asks the
 * keymap of the block it names, so the key is claimed by the binding that then runs.
 */

import type { AnyBlockKind } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
import type { RangeCoverage } from './range-coverage';
import { neighbourBeside, pointsForward, type RemovalGesture } from './caret-target';
import { blockNodeAt } from '../tree-operations/node-primitives';
import { firstCaretLeafFrom, previousCaretPath } from './path-lookup';

// ── Public API ─────────────────────────────────────────────────────────────

export type RemovalLanding =
	/** The start's own leaf, truncated or joined with what's left of the end. */
	| { at: 'start' }
	/** A cell of the table at `table`. */
	| { at: 'cell'; table: readonly number[] }
	/** Where what's left of the range's end begins, once `root` and the rest of the range went. */
	| { at: 'resume'; root: readonly number[] }
	/** The block beside `root`, the first block the range took whole, on the gesture's side. */
	| { at: 'beside'; root: readonly number[] };

/** Which removal a gesture over the range runs: a delete that keeps what it can, the blocks the
 *  range holds whole taken out, or a table's whole rows or columns. */
export type RangeRemoval = 'delete' | 'remove-whole' | 'remove-lines';

export function removalLanding(coverage: RangeCoverage, removal: RangeRemoval): RemovalLanding {
	const { start } = coverage.range;
	if (coverage.grid && removal !== 'remove-whole') return { at: 'cell', table: coverage.grid.path };
	if (coverage.startEdge) {
		return coverage.startCells ? { at: 'cell', table: start.path } : { at: 'start' };
	}
	const first = coverage.wholeRoots[0] ?? start.path;
	if (coverage.endEdge) return { at: 'resume', root: coverage.rootHolding(start.path) ?? first };
	return { at: 'beside', root: first };
}

/** The kind of the block the landing names, read on the tree before the removal. */
export function landingKind(
	doc: DocumentView,
	coverage: RangeCoverage,
	landing: RemovalLanding,
	gesture: RemovalGesture
): AnyBlockKind {
	const { start, end } = coverage.range;
	switch (landing.at) {
		case 'start':
			return kindAt(doc, start.path);
		case 'cell':
			return kindAt(doc, [...landing.table, 0, 0]);
		case 'resume':
			return coverage.endCells ? kindAt(doc, [...end.path, 0, 0]) : kindAt(doc, end.path);
		case 'beside': {
			const before = previousCaretPath(doc, landing.root);
			const after = firstCaretLeafFrom(doc, pastLastRoot(coverage));
			const beside = neighbourBeside(pointsForward(gesture), before, after);
			// A removal that empties the document leaves it one empty paragraph.
			return beside ? kindAt(doc, beside) : 'paragraph';
		}
	}
}

// ── Internal ───────────────────────────────────────────────────────────────

function kindAt(doc: DocumentView, path: readonly number[]): AnyBlockKind {
	return blockNodeAt(doc, [...path])?.kind ?? 'paragraph';
}

/** The slot just past the last block the range took whole. */
function pastLastRoot(coverage: RangeCoverage): number[] {
	const last = coverage.wholeRoots[coverage.wholeRoots.length - 1] ?? coverage.range.end.path;
	return [...last.slice(0, -1), last[last.length - 1] + 1];
}
