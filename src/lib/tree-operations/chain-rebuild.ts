/**
 * The ancestry rebuild: raws re-derived along an owned spine chain innermost-first, each
 * container's kind re-derived and the seam at its own slot asked on the way out (editor.md § 9).
 */

import type { CstNode } from '../core/nodes';
import type { SharingState } from './sharing';
import type { NodeParent } from './node-primitives';
import type { StructuralChange } from './structural-change';
import { dropChildSpans, type ChildRawChange } from '../schema/child-spans';
import type { GrammarView } from '../schema/block-openers';
import { trimTrailingLineEnding } from '../core/lines';
import { perfEnabled, recordRebuildDepth } from '../perf/instruments';
import { rebuildOwnedContainer, walkUnsharing } from './unshare';
import { absorbWindowSeams, type TrackedPosition } from './settle';
import { lineOpensAs, reclassifyContainer } from './content-write';
import { settleSublistSeparator } from './list/sublist-separator';

/**
 * Longest prefix of `chain` still attached under `root`, identity-checked level by level. A
 * commit mutation can splice a node out mid-ceremony, and rebuilding the detached node's raw
 * against its emptied children writes `raw: ''`; ancestors above the detachment still rebuild.
 */
export function attachedChainPrefix(root: NodeParent, chain: CstNode[]): CstNode[] {
	let parentChildren = root.children;
	for (let i = 0; i < chain.length; i++) {
		if (!parentChildren.includes(chain[i])) return chain.slice(0, i);
		parentChildren = chain[i].children ?? [];
	}
	return chain;
}

/**
 * One container slot a rebuild re-kinded. `previous` is the rollback register: a commit
 * unwinding after the swap has already published `replacement` into a live children array.
 */
export interface ContainerReclassification {
	siblings: CstNode[];
	index: number;
	previous: CstNode;
	replacement: CstNode;
}

/**
 * A fold the rebuilt container's own slot owed: its bytes stopped interrupting a neighbour, so
 * the parent's array reloads as fewer blocks. `before` is the pre-splice array, the rollback
 * register, since the splice lands in an array no commit descriptor covers.
 */
export interface AncestrySeamFold {
	/** Chain level of the folded container, so a caller composes the owner's path from its own. */
	depth: number;
	siblings: CstNode[];
	/** The chain node owning `siblings`, or null when they are the rebuild root's children. */
	owner: CstNode | null;
	change: StructuralChange;
	before: CstNode[];
	landing: TrackedPosition;
}

/**
 * What the typing door knows and a bare chain does not: where the chain sits in the document,
 * and the bytes its leaf carried before the write. Both are guesses the rebuild identity-checks.
 */
export interface ChainWriteHint {
	path: number[];
	leafPreviousRaw: string;
}

/**
 * Rebuild raws along an owned spine chain innermost-first, re-deriving each container's kind and
 * settling the seams at its own slot; chain- rather than path-based so it survives index shifts.
 * Both passes gate on a boundary line of the rebuilt raw moving. `folds` is required-nullable: a
 * fold splices the PARENT's array, so only a caller that reconciles that scope's ids/refs passes
 * a sink.
 */
export function rebuildUnsharedChain(
	root: NodeParent | CstNode,
	chain: CstNode[],
	sharing: SharingState,
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView | undefined,
	hint?: ChainWriteHint
): ContainerReclassification[] {
	const reclassified: ContainerReclassification[] = [];
	// The bytes chain[i + 1] held before this pass. It rides up only from a door that named the
	// leaf's own: a caller passing no hint re-derives at every level (editor.md § 9).
	let childPreviousRaw: string | undefined;
	for (let i = chain.length - 1; i >= 0; i--) {
		const node = chain[i];
		const rawBefore = node.raw;
		const child = chain[i + 1];
		rebuildOwnedContainer(
			node,
			sharing,
			child && childPreviousRaw !== undefined
				? childRawChange(node, child, childPreviousRaw, hint?.path[i + 1])
				: undefined
		);
		if (hint) childPreviousRaw = i === chain.length - 1 ? hint.leafPreviousRaw : rawBefore;

		const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
		const closerMoved = lastLine(rawBefore) !== lastLine(node.raw);
		if (!openerMoved && !closerMoved) continue;

		const owner = i === 0 ? null : chain[i - 1];
		const siblings = (owner ?? root).children;
		const index = siblings ? childIndexOf(siblings, node, hint?.path[i]) : -1;
		if (!siblings || index < 0) continue;

		if (openerMoved && lineOpensAs(firstLine(node.raw), grammar) !== node.kind) {
			const replacement = reclassifyContainer({ children: siblings }, index, grammar);
			if (replacement) {
				sharing.stamp(replacement);
				reclassified.push({ siblings, index, previous: node, replacement });
			}
		}
		// Ahead of the seam ask, which then reads the settled bytes: a list rebuilt down to an
		// empty marker owes the paragraph above it a separating line.
		if (openerMoved) settleSublistSeparator(siblings, index);
		// After the re-derive: the seam reads whatever occupies the slot now.
		if (folds) {
			const before = folds.length;
			settleSlotSeams(
				{ siblings, owner, depth: i, index, openerMoved, closerMoved },
				sharing,
				folds
			);
			// A fold re-tiled the owner's children, so its spans describe a shape that is gone.
			if (folds.length > before && owner) dropChildSpans(owner);
		}
	}
	if (perfEnabled()) recordRebuildDepth(chain.length);
	return reclassified;
}

/**
 * The changed-child hint for `node`, or undefined when `child` cannot be placed in it. The path
 * index is a guess; an identity match is what makes it an answer.
 */
function childRawChange(
	node: CstNode,
	child: CstNode,
	previousRaw: string,
	guess: number | undefined
): ChildRawChange | undefined {
	const siblings = node.children;
	if (!siblings) return undefined;
	const index = childIndexOf(siblings, child, guess);
	return index < 0 ? undefined : { index, previousRaw };
}

/** `indexOf` with a guess first: the scan is O(children) through the `$state` proxy. */
function childIndexOf(siblings: CstNode[], child: CstNode, guess: number | undefined): number {
	if (guess !== undefined && siblings[guess] === child) return guess;
	return siblings.indexOf(child);
}

/** Where a rebuilt container sits, and which of its joins its new bytes can have moved. */
interface ChainSlot {
	siblings: CstNode[];
	owner: CstNode | null;
	depth: number;
	index: number;
	/** The join ABOVE turns on the opener line, the one BELOW on the closer: each is asked only
	 *  when its own line moved, so a head-child edit never pays the follower-side parse. */
	openerMoved: boolean;
	closerMoved: boolean;
}

/**
 * Ask the joins at a rebuilt container's slot, since its new bytes can stop interrupting a
 * neighbour. `absorbWindowSeams` walks `at - 1 … at + added - 1`, so the two arguments below
 * name exactly the sides whose line moved.
 */
function settleSlotSeams(slot: ChainSlot, sharing: SharingState, folds: AncestrySeamFold[]): void {
	const { siblings, index, openerMoved, closerMoved } = slot;
	// The rollback snapshot is captured only once a fold is certain: an eager copy here cost
	// O(children) reactive reads on every keystroke inside a large container.
	let before: CstNode[] | null = null;
	const landing: TrackedPosition = { index, offset: 0 };
	const settled = absorbWindowSeams(
		{ children: siblings },
		openerMoved ? index : index + 1,
		openerMoved && closerMoved ? 1 : 0,
		index,
		{ op: 'noop' },
		sharing,
		landing,
		index,
		() => {
			before ??= siblings.slice();
		}
	);
	if (settled.change.op === 'noop') return;
	folds.push({
		depth: slot.depth,
		siblings,
		owner: slot.owner,
		change: settled.change,
		// A non-noop change means a splice ran, so the capture ran first.
		before: before!,
		landing
	});
}

/** The container's opener line. */
function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/** The container's closing line: its last line carrying bytes, without the ending. */
function lastLine(raw: string): string {
	const body = trimTrailingLineEnding(raw);
	const nl = body.lastIndexOf('\n');
	return nl < 0 ? body : body.slice(nl + 1);
}

/**
 * Unshare the spine to `path` and rebuild it innermost-first, tolerating paths that ran out of
 * range mid-walk (post-delete rebuild passes). Prefer `rebuildUnsharedChain` when indices may
 * have shifted since the unshare.
 */
export function rebuildUnsharedAncestry(
	root: NodeParent,
	path: number[],
	sharing: SharingState,
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView | undefined
): ContainerReclassification[] {
	const chain = walkUnsharing(root, path, sharing, false);
	return rebuildUnsharedChain(root, chain, sharing, folds, grammar);
}
