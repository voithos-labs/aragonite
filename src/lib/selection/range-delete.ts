/**
 * Core range mutation primitive, in place: truncate both endpoints, delete between, re-parse
 * the merged raw, cascade-clean empty ancestors, rebuild container raws. Caller pre-normalizes
 * the range. The "start wins" rule: `docs/design/editor.md` § Cross-block selection.
 */

import type { GrammarView } from '../schema/block-openers';
import type { CstNode, Document } from '../core/nodes';
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
	settleSeparatorOnBlank,
	writeOwnRaw
} from '../tree-operations/node-ops';
import {
	deleteSubtreesIdentityGated,
	installTruncatedEndpoint,
	reparseTruncatedEndpoint
} from './range-delete-ceremony';
import {
	ensureUnsharedNode,
	ensureUnsharedPath,
	rebuildUnsharedAncestry,
	rebuildUnsharedChain
} from '../tree-operations/unshare';
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
	 * Row splices performed on endpoint tables, so the cross-block commit can descriptor-sync
	 * each table's row BlockListState without re-deriving snap math. Table branch only.
	 */
	tableRowSplices?: TableRowSplice[];
}

/**
 * Delete [start, end] in place, merge at start's position with its container context preserved,
 * cascade-clean empty ancestors, rebuild container raws. Copy-path-on-write: every spliced or
 * written spine is unshared BEFORE target identities are captured, so the identity gate compares
 * post-unshare references. Caller pre-normalizes and keeps endpoints on focusable blocks.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState,
	grammar: GrammarView | undefined
): RangeDeleteResult {
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a block node');
	}

	if (involvesTable(startBlock, endBlock)) {
		return tableAwareRangeDelete(doc, start, end, sharing, grammar);
	}
	if (involvesReservedChrome(doc, start, end)) {
		return chromeAwareRangeDelete(doc, start, end, sharing, grammar);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = startBlock.raw;
	const endRaw = endBlock.raw;
	const startOffset = charOffsetOf(start, 'rangeDelete:prose-merge-start');
	const endOffset = charOffsetOf(end, 'rangeDelete:prose-merge-end');
	// The end slice answers to the END block's rule before the join: start's rule below speaks
	// only for start's bytes, so a truncation from the end block's head strands its closer. A
	// same-block merge is one block's bytes and takes that rule once, whole, on the arm below.
	const endTail = endRaw.slice(endOffset);
	// A join can MINT a line neither side held: two lines each carrying a mid-line `</details>`
	// become one that opens with it. The survivor lands in start's container, so it answers to
	// that container's body rule, applied here so the kinds derive from the bytes that land.
	const mergedRaw = normalizeBodyWrite(
		blockNodeAt(doc, start.path.slice(0, -1))?.kind,
		startRaw.slice(0, startOffset) + (sameBlock ? endTail : normalizeOwnRaw(endBlock, endTail))
	);

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		const chain = ensureUnsharedPath(doc, start.path, sharing);
		// start.path resolved above, so the chain reaches the leaf; the fallback still routes
		// through the unshare seam, never a raw capture.
		const owned = chain[chain.length - 1] ?? ensureUnsharedNode(startBlock, sharing);
		// No reparse on this arm, so the survivor's own grammar answers here: a join can mint
		// a line the kind reads as its terminator (a fence run in a code body).
		writeOwnRaw(owned, mergedRaw, grammar);
		// Ahead of the rebuild, which reads the body's trivia: a selection covering a block's whole
		// text leaves it blank, and a blank block is the separating line of the one below it.
		const parent = nodeAt(doc, start.path.slice(0, -1));
		if (parent) settleSeparatorOnBlank(parent, start.path[start.path.length - 1], sharing);
		rebuildUnsharedChain(doc, chain, sharing, grammar);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: startOffset }
		};
	}

	// Start's slot, start's rule: the survivor answers to it BEFORE the reparse re-derives
	// metadata, and inherits the slot's separator a fragment reparse would mint empty (#60).
	const replacement = reparseTruncatedEndpoint(startBlock, mergedRaw);

	// walkBetween includes ancestors of `end` whose subtrees extend past it, so filter to
	// subtrees fully inside (start, end). Cascade-cleanup handles ancestors emptied afterwards.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Unshare every spliced spine before capturing target identities: a copy made after capture
	// would fail the identity gate and skip the deletion.
	ensureUnsharedPath(doc, start.path, sharing);
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}

	deleteSubtreesIdentityGated(doc, deletionPaths, lcaPath, sharing);

	installTruncatedEndpoint(doc, start.path, replacement, sharing);

	rebuildUnsharedAncestry(doc, start.path, sharing, grammar);
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing, grammar);
	}

	// The re-parse may change kind, including leaf → CONTAINER (a list marker joined to its item
	// text). Caret restore walks the block element at its path, and a container path drops focus
	// on a non-editable wrapper, so descend to the leaf; a descended caret starts at 0.
	const leafPath = firstLeafAtOrAfter(doc, start.path);
	const collapsedCaret: SelectionPoint =
		leafPath && leafPath.length > start.path.length
			? { path: leafPath, offset: 0 }
			: { path: start.path.slice(), offset: startOffset };

	return { newDoc: doc, collapsedCaret };
}
