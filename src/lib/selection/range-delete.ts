/**
 * Deletes a covered range from the tree in place, merging what survives at the start. The
 * "start wins" rule is in `docs/design/editor.md` § Cross-block selection.
 */

import type { Reading } from '../schema/reading';
import type { CstNode, Document } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
import type { SelectionPoint } from './primitives';
import type { CoveredRange } from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import { walkBetween, charOffsetOf } from './primitives';
import { comparePaths, isPathSubtreeBetween, pathHasPrefix } from './path-math';
import { caretPointFor, type RemovalGesture } from './caret-target';
import { docPathFrom } from '../cursor/coordinate-spaces';
import {
	blockNodeAt,
	nodeAt,
	normalizeBodyWrite,
	normalizeOwnRaw
} from '../tree-operations/node-primitives';
import { settleSeparatorOnBlank } from '../tree-operations/settle';
import { isBlankParagraph } from '../core/parser';
import { displayLength, documentLineEnding } from '../core/lines';
import { cleanJoinedRaw } from '../tree-operations/node-ops';
import { storedAsAt } from '../tree-operations/stored-as';
import { joinKeepingSuffix } from '../tree-operations/structural-suffix';
import { deleteSubtreesIdentityGated, installSurvivor } from './range-delete-ceremony';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedAncestry } from '../tree-operations/chain-rebuild';
import { involvesTable, tableAwareRangeDelete } from './range-delete-table';
import { involvesReservedChrome, chromeAwareRangeDelete, removeWhole } from './range-delete-chrome';

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

/** Deletes what `range` covers in place, merging at the start's position inside its container.
 *  The caller keeps endpoints on focusable blocks; `gesture` lands the caret if a block goes. */
export function rangeDelete(
	doc: Document,
	range: CoveredRange,
	sharing: SharingState,
	reading: Reading,
	gesture: RemovalGesture
): RangeDeleteResult {
	const { grammar } = reading;
	const { start, end } = range;
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a block node');
	}

	// Both endpoints inside one container the range takes whole: that container goes, whatever
	// kind either endpoint sits in.
	const unit = range.unitHolding(start.path);
	if (unit && pathHasPrefix(end.path, unit))
		return removeWhole(doc, unit, sharing, reading, gesture);
	// A table or a container title line is never merged across: those branches truncate each
	// endpoint in place instead of joining them.
	if (involvesTable(startBlock, endBlock)) {
		return tableAwareRangeDelete(doc, range, sharing, reading, gesture);
	}
	if (involvesReservedChrome(doc, start, end)) {
		return chromeAwareRangeDelete(doc, range, sharing, reading);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = startBlock.raw;
	const startCut = charOffsetOf(start, 'rangeDelete:prose-merge-start');
	const endOffset = charOffsetOf(end, 'rangeDelete:prose-merge-end');

	// A range holding one block whole deletes it: the byte path would leave only a line ending,
	// which no reload reads as that kind. A paragraph stays, as the blank separating line.
	if (
		sameBlock &&
		startCut === 0 &&
		endOffset >= displayLength(startRaw) &&
		!isBlankParagraph({ kind: startBlock.kind, raw: '' })
	) {
		return removeWhole(doc, start.path, sharing, reading, gesture);
	}
	// A cross-block join runs the end slice through the end block's own write rule, or a cut from
	// its head would leave its closer stranded; a same-block merge takes the rule once, below.
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
		ensureUnsharedPath(doc, start.path, sharing);
		const shift = installSurvivor(doc, start.path, startBlock, joined.raw, sharing, reading);
		// Before the rebuild, which reads the blank lines: a selection covering a block's whole
		// text leaves it blank, and a blank block is the separating line of the one below it.
		const parent = nodeAt(doc, start.path.slice(0, -1));
		if (parent) settleSeparatorOnBlank(parent, start.path[start.path.length - 1], sharing);
		rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
		const joinAt = { path: start.path.slice(), offset: Math.max(0, joined.seam + shift) };
		return { newDoc: doc, caret: () => joinAt };
	}

	// walkBetween includes ancestors of `end` whose subtrees extend past it, so filter to
	// subtrees fully inside (start, end). Cascade-cleanup handles ancestors emptied afterwards.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];

	// Copy every spliced chain before capturing node identities: a copy made after capture would
	// fail the identity check and skip the deletion.
	ensureUnsharedPath(doc, start.path, sharing);
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}

	deleteSubtreesIdentityGated(doc, deletionPaths, sharing, grammar);

	const shift = installSurvivor(doc, start.path, startBlock, joined.raw, sharing, reading);

	rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, null, grammar);
	}

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
