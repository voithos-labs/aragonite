/**
 * The deletion steps every `rangeDelete` branch shares: the subtrees `rangeCoverage` holds whole
 * are spliced out in reverse document order, each only while it still holds the node captured up
 * front, then every ancestor left empty goes, up to the document. A kept edge is truncated and
 * reinstalled the way a reload would parse it.
 */

import type { GrammarView } from '../schema/block-openers';
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
import { deleteAtPath, replaceAtPath } from '../tree-operations/path-mutate';
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
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { attachedChainPrefix, rebuildUnsharedChain } from '../tree-operations/chain-rebuild';
import { slotReaderAt } from '../tree-operations/list/task-paragraph';
import {
	taskMarkerCaretShift,
	writeKeepingTaskMarker
} from '../tree-operations/list/reconcile-task';
/** Deletes in reverse order, each path only while it holds its captured node (cleanup can move a
 *  survivor there); the caller copies parent chains first so the check compares copies (G1.9). */
function deleteSubtreesIdentityGated(
	doc: Document,
	deletionPaths: number[][],
	sharing: SharingState,
	grammar: GrammarView
): void {
	const targetNodes = deletionPaths.map((p) => nodeAt(doc, p));
	const reverseSortedIndices = deletionPaths
		.map((_, i) => i)
		.sort((a, b) => comparePaths(deletionPaths[b], deletionPaths[a]));
	for (const i of reverseSortedIndices) {
		const path = deletionPaths[i];
		if (nodeAt(doc, path) === targetNodes[i]) {
			deleteAtPath(doc, path, sharing, grammar);
			cascadeCleanupEmptyAncestors(doc, path, sharing, grammar, documentLineEnding(doc));
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
	sharing: SharingState,
	reading: Reading
): number {
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
	const owner = blockNodeAt(doc, path.slice(0, -1)) ?? undefined;
	const slot = path[path.length - 1];
	const shift = slot === 0 && owner ? taskMarkerCaretShift(owner, written) : 0;
	const siblings = (owner ?? doc).children ?? [];
	// `replaceAtPath` fixes the blank lines around it so the tree reparses the same (G2.13).
	writeKeepingTaskMarker(owner, siblings, slot, sharing, () => {
		for (const node of replacement) sharing.stamp(node);
		replaceAtPath(doc, path, replacement, sharing, reading.grammar);
	});
	return shift;
}

/** Truncates the start endpoint in place, after the planned deletion, and returns the caret's
 *  offset. `isChrome` must be read before any splice moved the tree. */
export function truncateStartInPlace(
	doc: Document,
	start: SelectionPoint,
	startBlock: CstNode,
	isChrome: boolean,
	reading: Reading,
	sharing: SharingState,
	tag: string
): number {
	const cut = charOffsetOf(start, tag);
	const ending = documentLineEnding(doc);
	const lineEnding = trailingLineEnding(startBlock.raw, ending);
	if (isChrome) {
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
	const shift = installSurvivor(doc, start.path, startBlock, kept, sharing, reading);
	return Math.max(0, head.seam + shift);
}

/** Truncates the end endpoint in place, before the planned deletion while its path is valid,
 *  and returns the surviving tail as re-read through the tree, never the raw copy. */
export function truncateEndInPlace(
	doc: Document,
	end: SelectionPoint,
	endBlock: CstNode,
	isChrome: boolean,
	reading: Reading,
	sharing: SharingState,
	tag: string
): CstNode | null {
	const cut = charOffsetOf(end, tag);
	if (isChrome) {
		endBlock.raw =
			endBlock.raw.slice(cut) || trailingLineEnding(endBlock.raw, documentLineEnding(doc));
		return endBlock;
	}
	const tail = cleanTruncatedProse(endBlock, 'tail', cut, storedAsAt(doc, end.path, reading)).raw;
	installSurvivor(doc, end.path, endBlock, tail, sharing, reading);
	return blockNodeAt(doc, end.path);
}

// ── Cross-block deletion plan ───────────────────────────────────────────────
// Each branch truncates its kept edges around `applyPlannedDeletion` in its own order (an end
// before, a start after), so the steps are separate calls.

export interface DeletionPlan {
	deletionPaths: number[][];
	/** Each deletion path's parent chain, copied before any splice, for the rebuild after it. */
	parentChains: CstNode[][];
	chromeClearChain: CstNode[] | null;
	/** The sharing state the plan was collected against; the apply step's splices copy their
	 *  chains through it, so no branch has to pass it again. */
	sharing: SharingState;
}

/** Plans removing every subtree `coverage` holds whole, plus `alsoRemoved` (an end block whose
 *  tail joined the start); a covered title row is cleared instead, so it stays child 0. */
export function planCrossBlockDeletion(
	doc: Document,
	coverage: RangeCoverage,
	alsoRemoved: number[][],
	sharing: SharingState
): DeletionPlan {
	const clearPath = titleRowToClear(doc, coverage.range);
	let chromeClearChain: CstNode[] | null = null;
	const deletionPaths: number[][] = [];
	for (const root of coverage.wholeRoots) {
		if (clearPath && pathsEqual(root, clearPath)) {
			const chain = ensureUnsharedPath(doc, root, sharing);
			if (chain.length === root.length) chromeClearChain = chain;
		} else {
			deletionPaths.push(root.slice());
		}
	}
	deletionPaths.push(...alsoRemoved.map((path) => path.slice()));
	const parentChains = deletionPaths.map((path) =>
		ensureUnsharedPath(doc, path.slice(0, -1), sharing)
	);
	return { deletionPaths, parentChains, chromeClearChain, sharing };
}

/** Applies the plan: clears a surviving end container's covered title line (a raw write, never a
 *  node delete), then splices the covered subtrees. */
export function applyPlannedDeletion(
	doc: Document,
	plan: DeletionPlan,
	grammar: GrammarView
): void {
	const chrome = plan.chromeClearChain?.[plan.chromeClearChain.length - 1];
	if (chrome) chrome.raw = '\n';
	deleteSubtreesIdentityGated(doc, plan.deletionPaths, plan.sharing, grammar);
}

/** Rebuilds what is still attached of each removed subtree's parent chain, then the cleared title
 *  line's container, so every surviving container re-emits its raw. */
export function rebuildSharedAncestries(
	doc: Document,
	plan: DeletionPlan,
	sharing: SharingState,
	grammar: GrammarView
): void {
	for (const chain of plan.parentChains) {
		const attached = attachedChainPrefix(doc, chain);
		if (attached.length > 0) rebuildUnsharedChain(doc, attached, sharing, null, grammar);
	}
	if (plan.chromeClearChain)
		rebuildUnsharedChain(doc, plan.chromeClearChain, sharing, null, grammar);
}

/** The title row of the title-line container holding the end, when the start is outside it. */
function titleRowToClear(doc: Document, range: CoveredRange): number[] | null {
	const container = nearestChromeContainer(doc, range.end.path);
	if (!container || pathHasPrefix(range.start.path, container.path)) return null;
	return [...container.path, 0];
}
