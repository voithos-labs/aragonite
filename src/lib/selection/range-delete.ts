/**
 * Core range mutation primitive, in place: truncate both endpoints, delete between, re-parse
 * the merged raw, cascade-clean empty ancestors, rebuild container raws. Caller pre-normalizes
 * the range. The "start wins" rule: `docs/design/editor.md` § Cross-block selection.
 */

import type { GrammarView } from '../schema/block-openers';
import type { PresentationMode } from '../presentation-mode';
import type { InlineResolverRef } from '../schema/inline-construct-policy';
import { metadataOf, type CstNode, type Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { walkBetween, charOffsetOf } from './primitives';
import { comparePaths, lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import { firstLeafAtOrAfter } from './path-lookup';
import {
	blockNodeAt,
	nodeAt,
	normalizeBodyWrite,
	normalizeOwnRaw,
	writeOwnRaw
} from '../tree-operations/node-primitives';
import { settleSeparatorOnBlank } from '../tree-operations/settle';
import { isBlankParagraph } from '../core/parser';
import { displayLength } from '../core/lines';
import { deleteAtPath } from '../tree-operations/path-mutate';
import { cleanJoinedRaw } from '../tree-operations/node-ops';
import {
	deleteSubtreesIdentityGated,
	installTruncatedEndpoint,
	reparseTruncatedEndpoint
} from './range-delete-ceremony';
import { ensureUnsharedNode, ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedAncestry, rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import { involvesTable, tableAwareRangeDelete } from './range-delete-table';
import { involvesReservedChrome, chromeAwareRangeDelete } from './range-delete-chrome';

// ── Public API ──────────────────────────────────────────────────────────────

/** A whole-row window the table branch spliced out of `table.children`. */
export interface TableRowSplice {
	table: CstNode;
	at: number;
	count: number;
}

export interface RangeDeleteResult {
	newDoc: Document;
	collapsedCaret: SelectionPoint;
	/**
	 * Row splices made on the endpoint tables, so the cross-block commit can update each table's
	 * row `BlockListState` without redoing the snap math. Table branch only.
	 */
	tableRowSplices?: TableRowSplice[];
}

/** Whichever block takes the position gets the caret, at its start; the block above when none
 *  does. */
function deleteWholeUnit(
	doc: Document,
	path: number[],
	sharing: SharingState,
	grammar: GrammarView | undefined
): RangeDeleteResult {
	const parentPath = path.slice(0, -1);
	const index = path[path.length - 1];
	// Deleted by path, so the commit's id bookkeeping sees the position go.
	const chain = ensureUnsharedPath(doc, parentPath, sharing);
	deleteAtPath(doc, path, sharing);
	if (chain.length > 0) rebuildUnsharedChain(doc, chain, sharing, null, grammar);
	const survivors = (chain.length > 0 ? chain[chain.length - 1] : doc).children ?? [];
	const landing = Math.max(0, Math.min(index, survivors.length - 1));
	return { newDoc: doc, collapsedCaret: { path: [...parentPath, landing], offset: 0 } };
}

/**
 * Deletes [start, end] in place: merges at the start's position inside its container, cleans
 * up emptied ancestors, rebuilds container raws. Every chain that is spliced or written is
 * copied before node identities are captured, so the identity check compares the copies. The
 * caller normalizes the range and keeps the endpoints on focusable blocks.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState,
	grammar: GrammarView | undefined,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): RangeDeleteResult {
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a block node');
	}

	// The wall branches join nothing, but a truncation still leaves delimiter runs unpaired, so
	// their text endpoints go through the unpaired-run cleanup; only a title line's raw write
	// stays byte for byte.
	if (involvesTable(startBlock, endBlock)) {
		return tableAwareRangeDelete(doc, start, end, sharing, grammar, presentationMode, linkRef);
	}
	if (involvesReservedChrome(doc, start, end)) {
		return chromeAwareRangeDelete(doc, start, end, sharing, grammar, presentationMode, linkRef);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = startBlock.raw;
	const endRaw = endBlock.raw;
	const startOffset = charOffsetOf(start, 'rangeDelete:prose-merge-start');
	const endOffset = charOffsetOf(end, 'rangeDelete:prose-merge-end');

	// The range holds one block whole, so none of its bytes survive: the byte path below would
	// keep an empty leftover holding only a line ending, which no reload reads as that kind. A
	// paragraph is the one kind that survives empty, because a blank one is the separating line
	// below it.
	if (
		sameBlock &&
		startOffset === 0 &&
		endOffset >= displayLength(startRaw) &&
		!isBlankParagraph({ kind: startBlock.kind, raw: '' })
	) {
		return deleteWholeUnit(doc, start.path, sharing, grammar);
	}
	// The end slice goes through the end block's own write rule before the join: the start's
	// rule below covers only the start's bytes, so a cut from the end block's head would
	// otherwise leave its closer stranded. A same-block merge is one block's bytes and takes
	// that rule once, below.
	const endTail = endRaw.slice(endOffset);
	// A join can create a line neither side held: two lines each with a mid-line `</details>`
	// become one that opens with it. The survivor lands in the start's container, so that
	// container's body rule is applied here, before the kinds are derived from the bytes.
	const mergedRaw = normalizeBodyWrite(
		blockNodeAt(doc, start.path.slice(0, -1))?.kind,
		startRaw.slice(0, startOffset) + (sameBlock ? endTail : normalizeOwnRaw(endBlock, endTail))
	);
	// After both write rules and before either consumer: in live mode the runs the truncation
	// left unpaired, and the pair a join brings back to back, are bytes the user never saw
	// (live-mode.md § 4.5).
	const joined = cleanJoinedRaw(
		{
			mergedRaw,
			seam: startOffset,
			start: { node: startBlock, offset: startOffset },
			end: { node: endBlock, offset: endOffset },
			linkRef,
			ambientPrefix: containerAmbientPrefix(doc, start.path)
		},
		presentationMode
	);

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		const chain = ensureUnsharedPath(doc, start.path, sharing);
		// `start.path` resolved above, so the chain reaches the leaf; the fallback still copies
		// through `ensureUnsharedNode`, never a bare reference.
		const owned = chain[chain.length - 1] ?? ensureUnsharedNode(startBlock, sharing);
		// No reparse on this branch, so the kind's own write rule runs here: a join can create a
		// line the kind reads as its terminator (a fence run in a code body).
		writeOwnRaw(owned, joined.raw, grammar);
		// Before the rebuild, which reads the blank lines: a selection covering a block's whole
		// text leaves it blank, and a blank block is the separating line of the one below it.
		const parent = nodeAt(doc, start.path.slice(0, -1));
		if (parent) settleSeparatorOnBlank(parent, start.path[start.path.length - 1], sharing);
		rebuildUnsharedChain(doc, chain, sharing, null, grammar);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: joined.seam }
		};
	}

	// The survivor takes the start block's write rule before the reparse derives metadata, and
	// keeps the start's leading blank lines, which a fragment reparse would drop.
	const replacement = reparseTruncatedEndpoint(startBlock, joined.raw, grammar);

	// walkBetween includes ancestors of `end` whose subtrees extend past it, so filter to
	// subtrees fully inside (start, end). Cascade-cleanup handles ancestors emptied afterwards.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Copy every spliced chain before capturing node identities: a copy made after capture would
	// fail the identity check and skip the deletion.
	ensureUnsharedPath(doc, start.path, sharing);
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}

	deleteSubtreesIdentityGated(doc, deletionPaths, lcaPath, sharing);

	installTruncatedEndpoint(doc, start.path, replacement, sharing);

	rebuildUnsharedAncestry(doc, start.path, sharing, null, grammar);
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, null, grammar);
	}

	// The reparse may change the kind, even leaf to container (a list marker joined to its item
	// text). Caret restore focuses the element at the path, and a container path would focus a
	// non-editable wrapper, so descend to the leaf. The offset stays a byte offset (paste and
	// type-replace splice at it); the restore clamps it to where a caret can sit.
	const leafPath = firstLeafAtOrAfter(doc, start.path);
	const collapsedCaret: SelectionPoint =
		leafPath && leafPath.length > start.path.length
			? { path: leafPath, offset: 0 }
			: { path: start.path.slice(), offset: joined.seam };

	return { newDoc: doc, collapsedCaret };
}

/** The marker prefix the survivor renders under, so the join cleanup can read its result back
 *  through it (live-mode.md § 4.5). The marker is drawn in front of the container's first child
 *  only, the way `BlockList` forwards it, and a list item is the one built-in container that
 *  draws one. */
export function containerAmbientPrefix(doc: Document, path: readonly number[]): string {
	if (path.length < 2 || path[path.length - 1] !== 0) return '';
	const parent = blockNodeAt(doc, path.slice(0, -1));
	const item = parent?.kind === 'listItem' ? metadataOf(parent, 'listItem') : null;
	// A task item's marker carries its checkbox too, which is not modelled here: '' skips the
	// read-back rather than checking against the wrong prefix.
	return item && !item.taskItem ? item.marker : '';
}
