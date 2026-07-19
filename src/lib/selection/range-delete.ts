/**
 * Core range mutation primitive. Mutates the doc in place: truncate start
 * block, truncate end block, delete between, re-parse merged raw, cascade-
 * clean empty ancestors, rebuild ancestor container raws. Caller must
 * pre-normalize the range. The "start wins" rule is specified in
 * `docs/design/editor.md` § Cross-block selection.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import type { SharingState } from '../tree-operations/sharing';
import { parse } from '../core/parser';
import { walkBetween, charOffsetOf } from './primitives';
import { comparePaths, lowestCommonAncestor, isPathSubtreeBetween } from './path-math';
import { blockNodeAt } from '../tree-operations/node-ops';
import { replaceAtPath } from '../tree-operations/path-mutate';
import { deleteSubtreesIdentityGated } from './range-delete-ceremony';
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
	 * Row splices performed on endpoint tables, reported so the cross-block
	 * commit can descriptor-sync each table's row BlockListState without
	 * re-deriving snap math. Set (possibly empty) by the table branch only.
	 */
	tableRowSplices?: TableRowSplice[];
}

/**
 * Delete [start, end] in place, merge at start's position with its
 * container context preserved, cascade-clean empty ancestors, rebuild
 * container raws. Copy-path-on-write: every spine the op splices or writes
 * through is unshared up front — BEFORE target identities are captured, so
 * the identity gate compares post-unshare references. Returns the (mutated)
 * doc and the collapsed caret. Caller must pre-normalize the range and
 * ensure neither endpoint lands on a non-focusable block.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	sharing: SharingState
): RangeDeleteResult {
	const startBlock = blockNodeAt(doc, start.path);
	const endBlock = blockNodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a block node');
	}

	if (involvesTable(startBlock, endBlock)) {
		return tableAwareRangeDelete(doc, start, end, sharing);
	}
	if (involvesReservedChrome(doc, start, end)) {
		return chromeAwareRangeDelete(doc, start, end, sharing);
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;
	const startRaw = startBlock.raw;
	const endRaw = endBlock.raw;
	const startOffset = charOffsetOf(start, 'rangeDelete:prose-merge-start');
	const endOffset = charOffsetOf(end, 'rangeDelete:prose-merge-end');
	const mergedRaw = startRaw.slice(0, startOffset) + endRaw.slice(endOffset);

	if (sameBlock) {
		// May be nested in a blockquote/list/listItem whose raw depends on this leaf.
		const chain = ensureUnsharedPath(doc, start.path, sharing);
		// start.path resolved above, so the chain reaches the leaf; the fallback
		// still routes through the unshare seam, never a raw capture.
		const owned = chain[chain.length - 1] ?? ensureUnsharedNode(startBlock, sharing);
		owned.raw = mergedRaw;
		rebuildUnsharedChain(chain, sharing);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: startOffset }
		};
	}

	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];
	for (const node of replacement) sharing.stamp(node);

	// walkBetween includes ancestors of `end` whose subtrees extend past end —
	// filter to paths with subtrees fully inside (start, end). Cascade-cleanup
	// handles ancestors that become empty after their children are removed.
	const betweenPaths = walkBetween(doc, start.path, end.path).filter((p) =>
		isPathSubtreeBetween(p, start.path, end.path)
	);
	const deletionPaths: number[][] = [...betweenPaths, end.path];
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// Unshare every spliced spine before capturing target identities — a copy
	// made after capture would fail the identity gate and skip the deletion.
	ensureUnsharedPath(doc, start.path, sharing);
	for (const path of deletionPaths) {
		ensureUnsharedPath(doc, path.slice(0, -1), sharing);
	}

	deleteSubtreesIdentityGated(doc, deletionPaths, lcaPath);

	replaceAtPath(doc, start.path, replacement);

	rebuildUnsharedAncestry(doc, start.path, sharing);
	for (const path of deletionPaths) {
		rebuildUnsharedAncestry(doc, path, sharing);
	}

	return {
		newDoc: doc,
		collapsedCaret: { path: start.path.slice(), offset: start.offset }
	};
}
