/**
 * The ancestor rebuild: raws re-derived up an owned chain of ancestors innermost first, each
 * container's kind re-derived and the joins at its own position checked on the way out
 * (`docs/design/editor.md` § The container `raw` contract).
 */

import type { CstNode, Document } from '../core/nodes';
import { firstLineEnding } from '../core/lines';
import { assignChildIdsDeep, idsAcrossReread } from '../block-id';
import type { SharingState } from './sharing';
import {
	documentBody,
	ensureEditableContainers,
	type BodyParent,
	type NodeParent
} from './node-primitives';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { spliceMany } from './splice-many';
import { dropChildSpans, type ChildRawChange } from '../schema/child-spans';
import type { GrammarView } from '../schema/block-openers';
import { firstLine, followBytes, lastLine } from '../schema/container-raw';
import { reservedChromeKindOf } from '../schema/reserved-chrome';
import { perfEnabled, recordRebuildDepth } from '../perf/instruments';
import { rebuildOwnedContainer, walkUnsharing } from './unshare';
import { absorbWindowSeams, type TrackedPosition } from './settle';
import { installReading } from './content-write';
import { settleSublistSeparator } from './list/sublist-separator';

/**
 * Longest prefix of `chain` still attached under `root`: a node spliced out mid-commit would
 * rebuild against its emptied children to `raw: ''`, while the ancestors above it still rebuild.
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
 * One container position a rebuild gave a new kind. `previous` is what a rollback restores: a
 * commit unwinding after the swap has already written `replacement` into a live children array.
 */
export interface ContainerReclassification {
	siblings: CstNode[];
	index: number;
	previous: CstNode;
	replacement: CstNode;
}

/**
 * A merge at the rebuilt container's own position: its bytes stopped interrupting a neighbour,
 * so the parent's array reloads as fewer blocks. `before` is the pre-splice array, kept for
 * rollback, since the splice lands in an array no commit descriptor covers.
 */
export interface AncestrySeamFold {
	/** Chain level of the merged container, so a caller composes the owner's path from its own. */
	depth: number;
	siblings: CstNode[];
	/** The chain node owning `siblings`, or null when they are the rebuild root's children. */
	owner: CstNode | null;
	change: StructuralChange;
	before: CstNode[];
	landing: TrackedPosition;
}

/**
 * What the typing path knows and a bare chain does not: where the chain sits in the document,
 * and the bytes its leaf held before the write. Both are guesses the rebuild checks by identity.
 */
export interface ChainWriteHint {
	path: number[];
	leafPreviousRaw: string;
}

/**
 * One of several chains rebuilt in turn that share ancestors: this chain stops at level `floor`,
 * leaving the levels above to a later chain, which reads whole any node in `readsWhole`.
 */
export interface SharedChainLevels {
	readonly floor: number;
	readonly readsWhole: Set<CstNode>;
}

/**
 * The levels each chain rebuilds when the chains are rebuilt in this order, one per chain: a node
 * several chains hold is left to the last of them, so it's rebuilt once, after everything below it.
 */
export function sharedChainLevels(chains: readonly (readonly CstNode[])[]): SharedChainLevels[] {
	const lastHolder = new Map<CstNode, number>();
	chains.forEach((chain, j) => {
		for (const node of chain) lastHolder.set(node, j);
	});
	const readsWhole = new Set<CstNode>();
	return chains.map((chain, j) => {
		let floor = chain.length;
		while (floor > 0 && lastHolder.get(chain[floor - 1]) === j) floor--;
		return { floor, readsWhole };
	});
}

/**
 * Rebuild raws up an owned chain innermost first, re-deriving kinds and joins where a first or
 * last line moved. Only a caller that reconciles a merged array's ids and refs passes `folds`.
 */
export function rebuildUnsharedChain(
	root: NodeParent | CstNode,
	chain: CstNode[],
	sharing: SharingState,
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView,
	hint?: ChainWriteHint,
	shared?: SharedChainLevels
): ContainerReclassification[] {
	const reclassified: ContainerReclassification[] = [];
	const floor = shared?.floor ?? 0;
	// The bytes chain[i + 1] held before this pass, known only when the caller named the leaf's
	// own; with no hint, every level re-derives its whole raw.
	let childPreviousRaw: string | undefined;
	// The level below read as blocks its own position cannot hold, so this level reads whole.
	let spilled: Spill | null = null;
	for (let i = chain.length - 1; i >= floor; i--) {
		const node = chain[i];
		const rawBefore = node.raw;
		const child = chain[i + 1];
		const changed =
			child && childPreviousRaw !== undefined
				? childRawChange(node, child, childPreviousRaw, hint?.path[i + 1])
				: undefined;
		rebuildOwnedContainer(node, sharing, changed);
		if (hint) childPreviousRaw = i === chain.length - 1 ? hint.leafPreviousRaw : rawBefore;

		const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
		const closerMoved = lastLine(rawBefore) !== lastLine(node.raw);
		const whole = spilled !== null || (shared?.readsWhole.has(node) ?? false);
		spilled = null;
		if (!openerMoved && !closerMoved && !whole) continue;

		const owner = i === 0 ? null : chain[i - 1];
		const siblings = (owner ?? root).children;
		const index = siblings ? childIndexOf(siblings, node, hint?.path[i]) : -1;
		if (!siblings || index < 0) continue;

		const reading = followBytes(node, rawBefore, grammar, {
			titleRowOnly: changed !== undefined && isChromeSlot(node, changed.index),
			whole
		});
		const replacement = installReading({ children: siblings }, index, reading, grammar);
		if (replacement) {
			sharing.stamp(replacement);
			reclassified.push({ siblings, index, previous: node, replacement });
		} else if (reading.outcome === 'diverged' && reading.blocks.length > 0) {
			spilled = { siblings, index, node, blocks: reading.blocks };
		}
		if (!openerMoved && !closerMoved) continue;
		// Before the join check, which then reads the fixed-up bytes: a list rebuilt down to an
		// empty marker must give the paragraph above it a separating line.
		if (openerMoved) settleSublistSeparator(siblings, index);
		// After the kind re-derive: the join check reads whatever occupies the position now.
		if (folds) {
			const before = folds.length;
			settleSlotSeams(
				{ body: slotBody(root, owner), owner, depth: i, index, openerMoved, closerMoved },
				sharing,
				folds,
				grammar
			);
			// A merge re-divided the owner's children, so its child spans describe a shape that
			// is gone.
			if (folds.length > before && owner) dropChildSpans(owner);
		}
	}
	if (spilled && floor > 0) shared!.readsWhole.add(chain[floor - 1]);
	else if (spilled && folds) spliceSpill(spilled, sharing, folds);
	if (perfEnabled() && chain.length > floor) recordRebuildDepth(chain.length - floor);
	return reclassified;
}

/** A chain node whose bytes read as blocks its position cannot hold as one node. */
interface Spill {
	siblings: CstNode[];
	index: number;
	node: CstNode;
	blocks: CstNode[];
}

/**
 * The root's children take the blocks a top-level node's bytes read as, one fold the caller
 * publishes: the first block keeps the node's id, the rest are new.
 */
function spliceSpill(spill: Spill, sharing: SharingState, folds: AncestrySeamFold[]): void {
	const { siblings, index, node, blocks } = spill;
	// A blank tail the parse set aside has no block to hold it, so such bytes stay as they stand.
	if (blocks.map((block) => block.leadingTrivia + block.raw).join('') !== node.raw) return;
	const lineEnding = firstLineEnding(node.raw) ?? '\n';
	// The first block keeps the node's id, so its children the re-read left alone keep theirs.
	if (blocks[0].kind === node.kind && blocks[0].children) {
		blocks[0].childIds = idsAcrossReread(node.children ?? [], node.childIds, blocks[0].children);
	}
	for (const block of blocks) {
		ensureEditableContainers(block, lineEnding);
		assignChildIdsDeep(block);
	}
	blocks[0].leadingTrivia = node.leadingTrivia;
	const before = siblings.slice();
	spliceMany(siblings, index, 1, blocks);
	for (let k = 0; k < blocks.length; k++) sharing.stamp(siblings[index + k]);
	folds.push({
		depth: 0,
		siblings,
		owner: null,
		change: replacePreservingFirst(index, 1, blocks.length),
		before,
		landing: { index, offset: 0 }
	});
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

/** Whether child `index` is the container's title row, which no metadata comes from. */
function isChromeSlot(node: CstNode, index: number): boolean {
	const chromeKind = reservedChromeKindOf(node.kind);
	return index === 0 && chromeKind !== undefined && node.children?.[0]?.kind === chromeKind;
}

/** `indexOf` with a guess first: the scan is O(children) through the `$state` proxy. */
function childIndexOf(siblings: CstNode[], child: CstNode, guess: number | undefined): number {
	if (guess !== undefined && siblings[guess] === child) return guess;
	return siblings.indexOf(child);
}

/**
 * The body a rebuilt chain level sits in, for its join check: the chain node above owns it, and at
 * the root the document does, since only a rebuild from the document reports what a join folded.
 */
function slotBody(root: NodeParent | CstNode, owner: CstNode | null): BodyParent {
	if (!isDocumentRoot(root))
		throw new Error('chain rebuild: join checks need the document as root');
	const doc = documentBody(root);
	return owner ? { children: owner.children!, owner, lineEnding: doc.lineEnding } : doc;
}

const isDocumentRoot = (root: NodeParent | CstNode): root is Document =>
	'kind' in root && root.kind === 'document';

/** Where a rebuilt container sits, and which of its joins its new bytes can have moved. */
interface ChainSlot {
	body: BodyParent;
	/** The chain node owning `body`, or null at the rebuild root, which an ancestry fold names. */
	owner: CstNode | null;
	depth: number;
	index: number;
	/** The join above depends on the opener line and the one below on the closer, so each is
	 *  checked only when its own line moved. */
	openerMoved: boolean;
	closerMoved: boolean;
}

/**
 * Check the joins at a rebuilt container's position, since its new bytes can stop interrupting
 * a neighbour; the window passed below covers exactly the sides whose line moved.
 */
function settleSlotSeams(
	slot: ChainSlot,
	sharing: SharingState,
	folds: AncestrySeamFold[],
	grammar: GrammarView
): void {
	const { body, index, openerMoved, closerMoved } = slot;
	const siblings = body.children;
	// The rollback snapshot is captured only once a merge is certain, since a copy costs
	// O(children) reactive reads on every keystroke inside a large container.
	let before: CstNode[] | null = null;
	const landing: TrackedPosition = { index, offset: 0 };
	const settled = absorbWindowSeams(
		body,
		openerMoved ? index : index + 1,
		openerMoved && closerMoved ? 1 : 0,
		index,
		{ op: 'noop' },
		grammar,
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

/**
 * Copy the ancestors down `path` and rebuild them, tolerating a path cut short by a delete.
 * Prefer `rebuildUnsharedChain` when indices may have shifted since the copy.
 */
export function rebuildUnsharedAncestry(
	root: NodeParent,
	path: number[],
	sharing: SharingState,
	folds: AncestrySeamFold[] | null,
	grammar: GrammarView
): ContainerReclassification[] {
	const chain = walkUnsharing(root, path, sharing, false);
	return rebuildUnsharedChain(root, chain, sharing, folds, grammar);
}
