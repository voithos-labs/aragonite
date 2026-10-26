/**
 * The deletion steps every `rangeDelete` branch shares: the subtrees `rangeCoverage` holds whole
 * are spliced out in reverse document order, each only while it still holds the node captured up
 * front, then every ancestor left empty goes, up to the document. A kept edge is truncated and
 * reinstalled the way a reload would parse it, and an ordered list that lost items keeps its start.
 */

import type { Reading } from '../schema/reading';
import type { StoredAs } from '../schema/stored-as';
import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './primitives';
import { nearestChromeContainer, type CoveredRange, type RangeCoverage } from './range-coverage';
import type { SharingState } from '../tree-operations/sharing';
import {
	displayLength,
	documentLineEnding,
	terminateLine,
	trailingLineEnding
} from '../core/lines';
import { charOffsetOf } from './primitives';
import { comparePaths, pathHasPrefix, pathsEqual } from './path-math';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import type { ScopeWrites } from '../action-contracts';
import {
	blockNodeAt,
	emptyParagraph,
	nodeAt,
	normalizeOwnRaw
} from '../tree-operations/node-primitives';
import { cleanJoinedRaw } from '../tree-operations/leaf-range';
import { storedAsAt } from '../tree-operations/stored-as';
import { cutBeforeSuffix } from '../tree-operations/structural-suffix';
import { structuralSuffix } from '../core/inline';
import { attachedChainPrefix } from '../tree-operations/node-primitives';
import { slotReaderAt } from '../tree-operations/list/task-paragraph';
import {
	taskMarkerCaretShift,
	writeKeepingTaskMarker
} from '../tree-operations/list/reconcile-task';
import { ensureEditableContainers } from '../schema/opened-reading';
import { holdOrderedNumbering } from '../tree-operations/list/ordered-markers';

/** Deletes in reverse order, each path only while it holds its captured node (cleanup can move a
 *  survivor there); the caller copies parent chains first so the check compares copies (G1.9). */
function deleteSubtreesIdentityGated(
	doc: Document,
	deletionPaths: number[][],
	scope: ScopeWrites
): void {
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const reverseSortedIndices = deletionPaths
		.map((_, i) => i)
		.sort((a, b) => comparePaths(deletionPaths[b], deletionPaths[a]));
	for (const i of reverseSortedIndices) {
		const path = deletionPaths[i];
		if (path.length > 0 && nodeAt(doc, path) === targetNodes[i]) {
			scope.splice(path.slice(0, -1), path[path.length - 1], 1, []);
			cascadeCleanupEmptyAncestors(doc, scope, path);
		}
	}
}

/** A truncation is half a join, so in live mode the kept text drops unpaired delimiter runs:
 *  `docs/design/live-mode.md` § 4.5 Joins clean up where they meet. */
function cleanTruncatedProse(
	node: CstNode,
	kept: 'head' | 'tail',
	cut: number,
	store: StoredAs
): { raw: string; seam: number } {
	const join =
		kept === 'head'
			? {
					mergedRaw: node.raw.slice(0, cut),
					seam: cut,
					start: { node, offset: cut },
					end: { node, offset: displayLength(node.raw) }
				}
			: {
					mergedRaw: node.raw.slice(cut),
					seam: 0,
					start: { node, offset: 0 },
					end: { node, offset: cut }
				};
	return cleanJoinedRaw({ ...join, typed: '', store });
}

/** Installs `bytes` at `path` as a reload reads them there, through `source`'s write rule, keeping
 *  its leading blank lines and the task-marker rule; returns the caret shift a marker takes. */
export function installSurvivor(
	doc: Document,
	path: number[],
	source: CstNode,
	bytes: string,
	scope: ScopeWrites,
	reading: Reading
): number {
	const { sharing } = scope;
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(source.raw, ending);
	const written = normalizeOwnRaw(source, bytes, ending) || lineEnding;
	const reparsed = slotReaderAt(doc, path, reading.grammar)(written);
	const replacement = reparsed.children.slice();
	if (replacement.length === 0) {
		replacement.push(emptyParagraph(source.leadingTrivia, lineEnding));
	} else {
		replacement[0] = { ...replacement[0], leadingTrivia: source.leadingTrivia };
		// The trailing blank line the parser split off has no following block to attach to here,
		// so it stays in raw.
		replacement[replacement.length - 1].raw += reparsed.suffix;
	}
	// The slot reader reads plain, so a survivor that reads as a bare container gets its paragraph.
	for (const node of replacement) ensureEditableContainers(node, ending);
	const owner = blockNodeAt(doc, path.slice(0, -1)) ?? undefined;
	const slot = path[path.length - 1];
	const shift = slot === 0 && owner ? taskMarkerCaretShift(owner, written) : 0;
	const siblings = (owner ?? doc).children ?? [];
	// The splice fixes the blank lines around it so the tree reparses the same (G2.13).
	writeKeepingTaskMarker(owner, siblings, slot, sharing, () => {
		for (const node of replacement) sharing.stamp(node);
		scope.splice(path.slice(0, -1), slot, 1, replacement);
	});
	return shift;
}

/** Truncates the start endpoint in place, after the planned deletion, and returns the caret's
 *  offset. `isReservedChrome` must be read before any splice moved the tree. */
export function truncateStartInPlace(
	doc: Document,
	start: SelectionPoint,
	startBlock: CstNode,
	isReservedChrome: boolean,
	reading: Reading,
	scope: ScopeWrites,
	tag: string
): number {
	const cut = charOffsetOf(start, tag);
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(startBlock.raw, ending);
	if (isReservedChrome) {
		startBlock.raw = terminateLine(startBlock.raw.slice(0, cut), lineEnding);
		return cut;
	}
	// The kept head keeps the block's structure after it (a setext underline), as a join does.
	const head = cleanTruncatedProse(
		startBlock,
		'head',
		cutBeforeSuffix(startBlock, cut),
		storedAsAt(doc, start.path, reading)
	);
	const kept = terminateLine(head.raw + structuralSuffix(startBlock), lineEnding);
	const shift = installSurvivor(doc, start.path, startBlock, kept, scope, reading);
	return Math.max(0, head.seam + shift);
}

/** Truncates the end endpoint in place, before the planned deletion while its path is valid,
 *  and returns the surviving tail as re-read through the tree, never the raw copy. */
export function truncateEndInPlace(
	doc: Document,
	end: SelectionPoint,
	endBlock: CstNode,
	isReservedChrome: boolean,
	reading: Reading,
	scope: ScopeWrites,
	tag: string
): CstNode | null {
	const cut = charOffsetOf(end, tag);
	if (isReservedChrome) {
		endBlock.raw =
			endBlock.raw.slice(cut) || trailingLineEnding(endBlock.raw, documentLineEnding(doc));
		return endBlock;
	}
	const tail = cleanTruncatedProse(endBlock, 'tail', cut, storedAsAt(doc, end.path, reading)).raw;
	installSurvivor(doc, end.path, endBlock, tail, scope, reading);
	return blockNodeAt(doc, end.path);
}

// ── Cross-block deletion plan ───────────────────────────────────────────────
// Each branch truncates its kept edges around `applyPlannedDeletion` in its own order (an end
// before, a start after), so the steps are separate calls.

export interface DeletionPlan {
	deletionPaths: number[][];
	/** Each deletion path's parent chain, owned before any splice, which the commit rebuilds. */
	parentChains: CstNode[][];
	chromeClearChain: CstNode[] | null;
	/** Each ordered list on a parent chain, with its numbering read before any splice. */
	listNumbering: Map<CstNode, (sharing: SharingState) => void>;
	/** The scope the plan was collected against, which the apply step's splices go through. */
	scope: ScopeWrites;
}

/** Plans removing every subtree `coverage` holds whole, plus `alsoRemoved` (an end block whose
 *  tail joined the start); a covered title row is cleared instead, so it stays child 0. */
export function planCrossBlockDeletion(
	doc: Document,
	coverage: RangeCoverage,
	alsoRemoved: number[][],
	scope: ScopeWrites
): DeletionPlan {
	const clearPath = titleRowToClear(doc, coverage.range);
	let chromeClearChain: CstNode[] | null = null;
	const deletionPaths: number[][] = [];
	for (const root of coverage.wholeRoots) {
		if (clearPath && pathsEqual(root, clearPath)) {
			chromeClearChain = scope.own(root);
		} else {
			deletionPaths.push(root.slice());
		}
	}
	deletionPaths.push(...alsoRemoved.map((path) => path.slice()));
	const parentChains = deletionPaths.map((path) => scope.own(path.slice(0, -1)));
	// Read once every chain is copied, so a later chain's copy cannot replace an item read here.
	const listNumbering = new Map<CstNode, (sharing: SharingState) => void>();
	for (const node of parentChains.flat()) {
		if (node.kind === 'list' && !listNumbering.has(node)) {
			listNumbering.set(node, holdOrderedNumbering(node));
		}
	}
	return { deletionPaths, parentChains, chromeClearChain, listNumbering, scope };
}

/** Applies the plan: clears a surviving end container's covered title line (a raw write, never a
 *  node delete), then splices the covered subtrees. */
export function applyPlannedDeletion(doc: Document, plan: DeletionPlan): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, plan.scope);
}

/** Renumbers each attached ordered list the deletion took items from; the commit rebuilds every
 *  chain the plan owned. */
export function renumberAfterDeletion(doc: Document, plan: DeletionPlan): void {
	if (plan.listNumbering.size === 0) return;
	const attached = new Set(plan.parentChains.flatMap((chain) => attachedChainPrefix(doc, chain)));
	for (const [list, renumber] of plan.listNumbering) {
		if (attached.has(list)) renumber(plan.scope.sharing);
	}
}

/** The title row of the title-line container holding the end, when the start is outside it. */
function titleRowToClear(doc: Document, range: CoveredRange): number[] | null {
	const container = nearestChromeContainer(doc, range.end.path);
	if (!container || pathHasPrefix(range.start.path, container.path)) return null;
	return [...container.path, 0];
}
