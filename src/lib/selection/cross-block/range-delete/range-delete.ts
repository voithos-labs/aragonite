/**
 * Deletes a covered range from the tree in place, merging what survives at the start. The
 * "start wins" rule is in `docs/design/selection.md` § Cross-block selection.
 */

import type { Reading } from '../../../schema/reading';
import type { CstNode, Document } from '../../../core/nodes';
import type { DocumentView } from '../../../core/node-views';
import type { SelectionPoint } from '../../primitives';
import type { RangeCoverage } from '../../range-coverage';
import type { ScopeWrites } from '../../../action-contracts';
import { charOffsetOf } from '../../primitives';
import { comparePaths } from '../../path-math';
import { caretPointFor, type RemovalGesture } from '../../caret-target';
import { docPathFrom } from '../../../core/coordinate-spaces';
import {
	blockNodeAt,
	normalizeBodyWrite,
	normalizeOwnRaw
} from '../../../tree-operations/node-primitives';
import { displayLength, documentLineEnding } from '../../../core/lines';
import { isProseKind } from '../../../core/inline';
import { isMergeEligible } from '../../../schema/merge-rules';
import { cleanJoinedRaw } from '../../../tree-operations/leaf-range';
import { storedAsAt } from '../../../tree-operations/stored-as';
import { joinKeepingSuffix } from '../../../tree-operations/structural-suffix';
import {
	applyPlannedDeletion,
	installSurvivor,
	planCrossBlockDeletion,
	renumberAfterDeletion
} from './range-delete-ceremony';
import { clearGridCells, keepsTableEdge, tableAwareRangeDelete } from './range-delete-table';
import { involvesReservedChrome, unjoinedRangeDelete } from './range-delete-chrome';
import { removalLanding } from '../../removal-landing';

// ── Public API ──────────────────────────────────────────────────────────────

/** A whole-row window the table branch spliced out of `table.children`. */
export interface TableRowSplice {
	table: CstNode;
	at: number;
	count: number;
}

export interface RangeDeleteResult {
	newDoc: Document;
	/** Where the caret goes, read on the committed tree: the commit may still give an emptied
	 *  document its block. Null when no block holds a caret there. */
	caret: (committed: DocumentView) => SelectionPoint | null;
	/** Row splices made on the endpoint tables (table branch only), so the commit can update each
	 *  table's row `BlockListState` without redoing the snap math. */
	tableRowSplices?: TableRowSplice[];
}

/** Deletes what the coverage says the range covers, in place, merging at the start's position
 *  inside its container; `gesture` lands the caret if a block goes. */
export function rangeDelete(
	doc: Document,
	coverage: RangeCoverage,
	scope: ScopeWrites,
	reading: Reading,
	gesture: RemovalGesture
): RangeDeleteResult {
	const { start, end } = coverage.range;
	// A pair inside one table clears its cells, even all of them; only Backspace and Delete take
	// the rows, columns or table away, through the table's own structural commits.
	if (coverage.grid) return clearGridCells(doc, coverage, coverage.grid, scope);
	const landing = removalLanding(coverage, 'delete');
	if (keepsTableEdge(coverage)) {
		return tableAwareRangeDelete(doc, coverage, scope, reading, landing);
	}
	// Nothing merges across a title-line container's edge, and a range that holds an edge's block
	// whole has nothing there to merge.
	if (
		!coverage.startEdge ||
		!coverage.endEdge ||
		involvesReservedChrome(doc, start, end) ||
		!joinsAcross(doc, start, end)
	) {
		return unjoinedRangeDelete(doc, coverage, scope, reading, gesture, landing);
	}
	return joinedRangeDelete(doc, coverage, scope, reading);
}

/** Deletes every subtree the range holds whole and truncates each edge it keeps, never merging:
 *  Backspace or Delete over a table held whole removes it, where `rangeDelete` clears it. */
export function removeHeldWhole(
	doc: Document,
	coverage: RangeCoverage,
	scope: ScopeWrites,
	reading: Reading,
	gesture: RemovalGesture
): RangeDeleteResult {
	const landing = removalLanding(coverage, 'remove-whole');
	return unjoinedRangeDelete(doc, coverage, scope, reading, gesture, landing);
}

// ── Internal ────────────────────────────────────────────────────────────────

/** An edge that cuts nothing of its block (an end at its first byte, a start past its last) joins
 *  when the block holds text or Backspace would merge the two; a rule or a fence stays whole. */
function joinsAcross(doc: Document, start: SelectionPoint, end: SelectionPoint): boolean {
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	// Inside one block a range always cuts what it covers.
	if (!startBlock || !endBlock || comparePaths(start.path, end.path) === 0) return true;
	const merges = isMergeEligible(startBlock.kind, endBlock.kind);
	if (end.offset === 0 && !merges && !isProseKind(endBlock.kind)) return false;
	return start.offset < displayLength(startBlock.raw) || merges || isProseKind(startBlock.kind);
}

/** Both edges kept and plain: the end's tail joins the start's head in the start's block. */
function joinedRangeDelete(
	doc: Document,
	coverage: RangeCoverage,
	scope: ScopeWrites,
	reading: Reading
): RangeDeleteResult {
	const { start, end } = coverage.range;
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a block node');
	}
	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = startBlock.raw;
	const startCut = charOffsetOf(start, 'rangeDelete:prose-merge-start');
	const endOffset = charOffsetOf(end, 'rangeDelete:prose-merge-end');

	// A cross-block join runs the end slice through the end block's own write rule, which reads the
	// end block's shape; a same-block merge takes the rule once, below.
	const join = sameBlock
		? {
				raw: startRaw.slice(0, startCut) + startRaw.slice(endOffset),
				start: startCut,
				end: endOffset
			}
		: joinKeepingSuffix(startBlock, startCut, endBlock, endOffset, (tail) =>
				normalizeOwnRaw(endBlock, tail, documentLineEnding(doc))
			);
	const startOffset = join.start;
	// A join can create a line neither side held (two mid-line `</details>` joined into one that
	// opens with it), so the start container's body rule runs before kinds are derived.
	const mergedRaw = normalizeBodyWrite(
		blockNodeAt(doc, start.path.slice(0, -1)) ?? undefined,
		join.raw,
		documentLineEnding(doc)
	);
	// Runs after both write rules and before either consumer, dropping live-mode bytes the user
	// never saw: `docs/design/live-mode.md` § 4.5 Joins clean up where they meet.
	const joined = cleanJoinedRaw({
		mergedRaw,
		seam: startOffset,
		start: { node: startBlock, offset: startOffset },
		end: { node: endBlock, offset: join.end },
		typed: '',
		store: storedAsAt(doc, start.path, reading)
	});

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		scope.own(start.path);
		const shift = installSurvivor(
			doc,
			start.path,
			startBlock,
			joined.raw,
			startRaw,
			scope,
			reading
		);
		const joinAt = { path: start.path.slice(), offset: Math.max(0, joined.seam + shift) };
		return { newDoc: doc, caret: () => joinAt };
	}

	// The end block goes once its tail has joined the start. Every chain is copied before the
	// splices capture node identities, or a later copy would fail the check and skip a deletion.
	scope.own(start.path);
	const plan = planCrossBlockDeletion(doc, coverage, [end.path], scope);
	applyPlannedDeletion(doc, plan);
	// What the join takes the place of is both blocks, so a line kept from the end block counts as
	// there before.
	const consumed = startRaw + endBlock.raw;
	const shift = installSurvivor(doc, start.path, startBlock, joined.raw, consumed, scope, reading);
	renumberAfterDeletion(doc, plan);

	// The reparse can turn the survivor into a container (a list marker joined to text), whose own
	// element holds no caret, so the join point resolves to the leaf that holds it.
	const joinAt: SelectionPoint = {
		path: start.path.slice(),
		offset: Math.max(0, joined.seam + shift)
	};
	const landing =
		caretPointFor(doc, { path: docPathFrom(joinAt.path), offset: joinAt.offset }) ?? joinAt;

	return { newDoc: doc, caret: () => landing };
}
