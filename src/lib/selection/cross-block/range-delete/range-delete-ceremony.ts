/**
 * The deletion steps every `rangeDelete` branch shares: the subtrees `rangeCoverage` holds whole
 * are spliced out in reverse document order, each only while it still holds the node captured up
 * front, then every ancestor left empty goes, up to the document. A kept edge is truncated and
 * reinstalled the way a reload would parse it, and an ordered list that lost items keeps its start.
 */

import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';
import type { CstNode, Document } from '../../../core/nodes';
import type { SelectionPoint } from '../../primitives';
import type { NodeView } from '../../../core/node-views';
import { rowKeepingTitleFrom, rowKeepingTitleTo } from '../../../schema/reserved-chrome';
import {
	nearestChromeContainer,
	type CoveredRange,
	type RangeCoverage
} from '../../range-coverage';
import type { SharingState } from '../../../tree-operations/sharing';
import {
	displayLength,
	documentLineEnding,
	isBlankLine,
	splitLines,
	terminateLine,
	trailingLineEnding
} from '../../../core/lines';
import { charOffsetOf } from '../../primitives';
import { comparePaths, pathHasPrefix, pathsEqual } from '../../path-math';
import { cascadeCleanupEmptyAncestors } from '../../../tree-operations/cleanup';
import type { ScopeWrites } from '../../../action-contracts';
import {
	blockNodeAt,
	emptyParagraph,
	nodeAt,
	normalizeOwnRaw
} from '../../../tree-operations/node-primitives';
import { closeWrittenOpeners } from '../../../tree-operations/content-write';
import { cleanJoinedRaw } from '../../../tree-operations/leaf-range';
import { storedAsAt } from '../../../tree-operations/stored-as';
import { cutBeforeSuffix } from '../../../tree-operations/structural-suffix';
import { structuralSuffix } from '../../../core/inline';
import { attachedChainPrefix } from '../../../tree-operations/node-primitives';
import { slotReaderAt } from '../../../tree-operations/list/task-paragraph';
import {
	taskMarkerCaretShift,
	writeKeepingTaskMarker
} from '../../../tree-operations/list/reconcile-task';
import { ensureEditableContainers } from '../../../schema/opened-reading';
import {
	holdOrderedNumbering,
	orderedBaseOf,
	renumberOrderedListFrom
} from '../../../tree-operations/list/ordered-markers';
import {
	bytesWithoutMarkerLine,
	mergesByMarkerLine
} from '../../../tree-operations/list/marker-line';
import { rebuildOwnedContainer } from '../../../tree-operations/unshare';
import { assignChildIdsDeep } from '../../../block-id';

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

/** Installs `bytes`, which take the place of `before`, at `path` as a reload reads them there, made
 *  legal like any write there; returns the caret shift a task marker takes. */
export function installSurvivor(
	doc: Document,
	path: number[],
	source: CstNode,
	bytes: string,
	before: string,
	scope: ScopeWrites,
	reading: Reading
): number {
	const { sharing } = scope;
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(source.raw, ending);
	const owner = blockNodeAt(doc, path.slice(0, -1)) ?? undefined;
	const slot = path[path.length - 1];
	const siblings = (owner ?? doc).children ?? [];
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
	// The slot reader reads plain, so a bare container gets its paragraph, and child ids: one landing
	// where a container of its kind stood keeps that component, which keys its children by them.
	for (const node of replacement) {
		ensureEditableContainers(node, ending);
		assignChildIdsDeep(node);
	}
	const holder = owner ? { children: siblings, owner, lineEnding: ending } : doc;
	const closed = closeWrittenOpeners(holder, slot, before, replacement, reading.grammar);
	const shift = slot === 0 && owner ? taskMarkerCaretShift(owner, written) : 0;
	// The splice fixes the blank lines around it so the tree reparses the same (G2.13).
	writeKeepingTaskMarker(owner, siblings, slot, sharing, () => {
		for (const node of closed) sharing.stamp(node);
		scope.splice(path.slice(0, -1), slot, 1, closed);
	});
	return shift;
}

/** Truncates the start endpoint in place, after the planned deletion, and returns the caret's
 *  offset. `rowOwner`, the container whose title row the start is, must be read before any splice. */
export function truncateStartInPlace(
	doc: Document,
	start: SelectionPoint,
	startBlock: CstNode,
	rowOwner: NodeView | null,
	reading: Reading,
	scope: ScopeWrites,
	tag: string
): number {
	const cut = charOffsetOf(start, tag);
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(startBlock.raw, ending);
	if (rowOwner) {
		const head = rowKeepingTitleTo(rowOwner, startBlock, cut);
		startBlock.raw = head + lineEnding;
		return head.length;
	}
	// The kept head keeps the block's structure after it (a setext underline), as a join does.
	const head = cleanTruncatedProse(
		startBlock,
		'head',
		cutBeforeSuffix(startBlock, cut),
		storedAsAt(doc, start.path, reading)
	);
	const kept = terminateLine(head.raw + structuralSuffix(startBlock), lineEnding);
	const shift = installSurvivor(doc, start.path, startBlock, kept, startBlock.raw, scope, reading);
	return Math.max(0, head.seam + shift);
}

/** Truncates the end endpoint in place, before the planned deletion while its path is valid,
 *  and returns the surviving tail as re-read through the tree, never the raw copy. */
export function truncateEndInPlace(
	doc: Document,
	end: SelectionPoint,
	endBlock: CstNode,
	rowOwner: NodeView | null,
	reading: Reading,
	scope: ScopeWrites,
	tag: string
): CstNode | null {
	const cut = charOffsetOf(end, tag);
	if (rowOwner) {
		const lineEnding = trailingLineEnding(endBlock.raw, documentLineEnding(doc));
		endBlock.raw = rowKeepingTitleFrom(rowOwner, endBlock, cut) + lineEnding;
		return endBlock;
	}
	const tail = cleanTruncatedProse(endBlock, 'tail', cut, storedAsAt(doc, end.path, reading)).raw;
	installSurvivor(doc, end.path, endBlock, tail, endBlock.raw, scope, reading);
	return blockNodeAt(doc, end.path);
}

// ── Cross-block deletion plan ───────────────────────────────────────────────
// Each branch truncates its kept edges around `applyPlannedDeletion` in its own order (an end
// before, a start after), so the steps are separate calls.

export interface DeletionPlan {
	deletionPaths: number[][];
	/** Each deletion path's parent chain, owned before any splice, which the commit rebuilds. */
	parentChains: CstNode[][];
	/** The chain down to each list item whose first block the range takes while the item stays;
	 *  that block waits in place for the finish step, which takes the item's marker line with it. */
	openedItems: CstNode[][];
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
	const taken = [...deletionPaths, ...alsoRemoved.map((path) => path.slice())];
	const opens = taken.map((path) => opensItem(doc, path));
	const parentChains = taken.map((path) => scope.own(path.slice(0, -1)));
	// Read once every chain is copied, so a later chain's copy cannot replace an item read here.
	const listNumbering = new Map<CstNode, (sharing: SharingState) => void>();
	for (const node of parentChains.flat()) {
		if (node.kind === 'list' && !listNumbering.has(node)) {
			listNumbering.set(node, holdOrderedNumbering(node));
		}
	}
	return {
		deletionPaths: taken.filter((_, i) => !opens[i]),
		parentChains,
		openedItems: parentChains.filter((_, i) => opens[i]),
		chromeClearChain,
		listNumbering,
		scope
	};
}

/** Whether the block at `path` is the first block of an item whose marker line goes with it. */
function opensItem(doc: Document, path: readonly number[]): boolean {
	if (path.length < 3 || path[path.length - 1] !== 0) return false;
	return mergesByMarkerLine(blockNodeAt(doc, path.slice(0, -2)) ?? undefined);
}

/** Applies the plan: clears the title on a surviving end container's covered title row (a raw
 *  write that keeps any `:::name` marker, never a node delete), then splices the covered subtrees. */
export function applyPlannedDeletion(doc: Document, plan: DeletionPlan): void {
	const chain = plan.chromeClearChain;
	if (chain && chain.length >= 2) {
		const [container, row] = chain.slice(-2);
		const lineEnding = trailingLineEnding(row.raw, documentLineEnding(doc));
		row.raw = rowKeepingTitleFrom(container, row, row.raw.length) + lineEnding;
	}
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, plan.scope);
}

/** Runs once both edges are written: the items the range opened lose their marker lines, and each
 *  attached ordered list the deletion took items from renumbers. */
export function finishPlannedDeletion(doc: Document, plan: DeletionPlan, reading: Reading): void {
	// Innermost first, so an outer item reads the lines an inner one left; a bare item goes before
	// the renumber, which then sees its list without it.
	const innermostFirst = [...plan.openedItems].sort((a, b) => b.length - a.length);
	const holding = innermostFirst.filter((chain) => !removeIfBare(doc, chain, plan.scope));
	const attached = new Set(plan.parentChains.flatMap((chain) => attachedChainPrefix(doc, chain)));
	for (const [list, renumber] of plan.listNumbering) {
		if (attached.has(list)) renumber(plan.scope.sharing);
	}
	for (const chain of holding) dropMarkerLine(doc, chain, plan.scope, reading);
}

/** Removes the item at the end of `chain`, and every container that empties, when its first block
 *  is all it holds. True when it went. */
function removeIfBare(doc: Document, chain: CstNode[], scope: ScopeWrites): boolean {
	if ((chain[chain.length - 1].children?.length ?? 0) > 1) return false;
	const path = pathAlong(doc, chain);
	if (path) {
		scope.splice(path.slice(0, -1), path[path.length - 1], 1, []);
		cascadeCleanupEmptyAncestors(doc, scope, path);
	}
	return true;
}

/** The item at the end of `chain` without its marker line and first block: its list re-read from
 *  the bytes left, as a reload reads them where the list stood. */
function dropMarkerLine(
	doc: Document,
	chain: CstNode[],
	scope: ScopeWrites,
	reading: Reading
): void {
	const path = pathAlong(doc, chain);
	if (!path) return;
	const listPath = path.slice(0, -1);
	const index = path[path.length - 1];
	const list = blockNodeAt(doc, listPath)!;
	rebuildWritten(list, scope.sharing);
	const base = orderedBaseOf(list.children![0]);
	let bytes = bytesWithoutMarkerLine(list.children!, index);
	// At the list's top the blank line above the marker line is the list's own, and the blank lines
	// under the item's first block now part what the item left from the block above the list.
	const lead = index === 0 ? leadingBlankLines(bytes) : list.leadingTrivia;
	bytes = bytes.slice(index === 0 ? lead.length : 0);
	installSurvivor(doc, listPath, { ...list, leadingTrivia: lead }, bytes, list.raw, scope, reading);
	const reread = blockNodeAt(doc, listPath);
	if (reread?.kind !== 'list') return;
	renumberOrderedListFrom(reread, base, scope.sharing);
	// The commit rebuilds the chains it owned, and a list the read made is on none of them.
	rebuildOwnedContainer(reread);
}

function leadingBlankLines(text: string): string {
	let end = 0;
	for (const line of splitLines(text)) {
		if (!isBlankLine(line.text)) break;
		end = line.end;
	}
	return text.slice(0, end);
}

/** `chain`'s child indices from the document down; null once a splice took one of its nodes. */
function pathAlong(doc: Document, chain: readonly CstNode[]): number[] | null {
	const path: number[] = [];
	let siblings: readonly CstNode[] = doc.children;
	for (const node of chain) {
		const index = siblings.indexOf(node);
		if (index < 0) return null;
		path.push(index);
		siblings = node.children ?? [];
	}
	return path;
}

/** Rebuilds the raw of every container below `root` this edit copied, deepest first, so the bytes
 *  read from them are current; a shared one is untouched and an undo entry's. */
function rebuildWritten(root: CstNode, sharing: SharingState): void {
	for (const child of root.children ?? []) {
		if (!child.children || sharing.isShared(child)) continue;
		rebuildWritten(child, sharing);
		rebuildOwnedContainer(child);
	}
}

/** The title row of the title-line container holding the end, when the start is outside it. */
function titleRowToClear(doc: Document, range: CoveredRange): number[] | null {
	const container = nearestChromeContainer(doc, range.end.path);
	if (!container || pathHasPrefix(range.start.path, container.path)) return null;
	return [...container.path, 0];
}
