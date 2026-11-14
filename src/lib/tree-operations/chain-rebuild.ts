/**
 * The ancestor rebuild: raws re-derived up an owned chain of ancestors innermost first, each
 * container's kind re-derived and the joins at its own position checked on the way out
 * (`docs/design/structural-edits.md` § The container `raw` contract).
 */

import type { CstNode, Document } from '../core/nodes';
import { firstLineEnding } from '../core/lines';
import { assignChildIdsDeep, keepUnchanged } from '../block-id';
import type { SharingState } from './sharing';
import { documentBody, spliceList, type BodyParent, type NodeParent } from './node-primitives';
import { ensureEditableContainers } from '../schema/opened-reading';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { dropChildSpans, type ChildRawChange } from '../schema/child-spans';
import { unfinishedReadings, type GrammarView } from '../schema/block-openers';
import { blockFacts } from '../schema/block-facts';
import { firstLine, followBytes, lastLine } from '../schema/container-raw';
import { reservedChromeKindOf, rowMarker } from '../schema/reserved-chrome';
import { perfEnabled, recordRebuildDepth } from '../perf/instruments';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { checkFoldKeepsLines, foldedBytes } from '../invariants/fold-keeps-lines';
import { checkWrittenInPlaceReadsBack } from '../invariants/settled-window-reads-back';
import { rebuildOwnedContainer, walkUnsharing } from './unshare';
import { fixUpWrite, mergeJoinsAt, rereadWaitAt, type TrackedPosition } from './fix-up/apply';
import { waitsInto } from './container-window';
import { installReading, settledCaretPosition } from './content-write';
import { settleSublistSeparator } from './list/sublist-separator';

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
	/** The container stands at its index as the same kind, so a path into it still holds. */
	keepsPaths: boolean;
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
	// The level below read as blocks its list cannot hold, so this level reads whole.
	let spilled = false;
	for (let i = chain.length - 1; i >= floor; i--) {
		const node = chain[i];
		const rawBefore = node.raw;
		const child = chain[i + 1];
		const changed =
			child && childPreviousRaw !== undefined
				? childRawChange(node, child, childPreviousRaw, hint?.path[i + 1])
				: undefined;
		const rereads = rebuildOwnedContainer(node, changed)?.rereads ?? false;
		if (hint) childPreviousRaw = i === chain.length - 1 ? hint.leafPreviousRaw : rawBefore;

		const openerMoved = firstLine(rawBefore) !== firstLine(node.raw);
		const closerMoved = lastLine(rawBefore) !== lastLine(node.raw);
		const whole = rereads || spilled || (shared?.readsWhole.has(node) ?? false);
		spilled = false;
		const moved = openerMoved || closerMoved;
		const owner = i === 0 ? null : chain[i - 1];
		// A blank line above ends every wait, so only a container flush under a block is asked.
		const mayBeWaitedOn =
			folds !== null && node.leadingTrivia === '' && rawBefore !== node.raw && holdsBlocks(owner);
		if (!moved && !whole && !mayBeWaitedOn) continue;

		const siblings = (owner ?? root).children;
		const index = siblings ? childIndexOf(siblings, node, hint?.path[i]) : -1;
		if (!siblings || index < 0) continue;

		// The position took a block of another kind, so the join on either side can read otherwise.
		let rekinded = false;
		if (moved || whole) {
			const reading = followBytes(node, rawBefore, grammar, {
				titleRowOnly: changed !== undefined && onlyTitleChanged(node, changed),
				whole
			});
			const replacement = installReading({ children: siblings }, index, reading, grammar);
			if (replacement) {
				sharing.stamp(replacement);
				reclassified.push({ siblings, index, previous: node, replacement });
				rekinded = replacement.kind !== node.kind;
			} else if (reading.outcome === 'diverged' && reading.blocks.length > 0) {
				const spill = { index, node, rawBefore, blocks: reading.blocks };
				// A list of blocks takes them as it takes a typed write's; an item or a row is no block.
				if (
					folds &&
					holdsBlocks(owner) &&
					writeSpill(
						spill,
						{ body: slotBody(root, owner), owner, depth: i },
						sharing,
						folds,
						grammar
					)
				) {
					if (owner) dropChildSpans(owner);
					continue;
				}
				// A node whose bytes read otherwise has no join of its own to ask.
				if (openerMoved) settleSublistSeparator(siblings, index);
				spilled = true;
				continue;
			}
		}
		// Before the join check, which then reads the fixed-up bytes: a list rebuilt down to an
		// empty marker must give the paragraph above it a separating line.
		if (openerMoved) settleSublistSeparator(siblings, index);
		if (!folds) continue;
		const above = openerMoved || rekinded;
		const below = closerMoved || rekinded;
		const slot = { body: slotBody(root, owner), owner, depth: i, index };
		const here = siblings[index];
		const before = folds.length;
		// After the kind re-derive: the join check reads whatever occupies the position now.
		if (above || below) settleSlotSeams({ ...slot, above, below }, sharing, folds, grammar);
		if (mayBeWaitedOn && siblings[index] === here) {
			settleSlotWait(slot, openerMoved, sharing, folds, grammar);
			// Not while the perf rows count a keystroke's parses, since the check reads the run around.
			if (!perfEnabled())
				assertInvariant('settled-window-reads-back', () =>
					checkWrittenInPlaceReadsBack(slot.body, index, grammar)
				);
		}
		// A merge re-divided the owner's children, so its child spans describe a shape that is gone.
		if (folds.length > before && owner) dropChildSpans(owner);
	}
	if (spilled && floor > 0) shared!.readsWhole.add(chain[floor - 1]);
	if (perfEnabled() && chain.length > floor) recordRebuildDepth(chain.length - floor);
	return reclassified;
}

/** A chain node whose new bytes read as blocks its position cannot hold as one node. */
interface Spill {
	index: number;
	node: CstNode;
	rawBefore: string;
	blocks: CstNode[];
}

/**
 * The slot's list takes the blocks a node's new bytes read as, fixed up as a typed write of those
 * bytes is, in one fold the caller publishes. False when the blocks don't spell the node's bytes.
 */
function writeSpill(
	spill: Spill,
	slot: Pick<ChainSlot, 'body' | 'owner' | 'depth'>,
	sharing: SharingState,
	folds: AncestrySeamFold[],
	grammar: GrammarView
): boolean {
	const { index, node, blocks } = spill;
	const { body } = slot;
	// A blank tail the parse set aside has no block to hold it, so such bytes stay as they stand.
	if (blocks.map((block) => block.leadingTrivia + block.raw).join('') !== node.raw) return false;
	const lineEnding = firstLineEnding(node.raw) ?? '\n';
	// The first block keeps the node's id, so its children the re-read left alone stay as they were.
	keepUnchanged(node, blocks[0]);
	for (const block of blocks) {
		ensureEditableContainers(block, lineEnding);
		assignChildIdsDeep(block);
	}
	blocks[0].leadingTrivia = node.leadingTrivia;
	const fold = foldWrite(slot, folds);
	fold.capture();
	spliceList(body, index, 1, blocks);
	for (let k = 0; k < blocks.length; k++) sharing.stamp(body.children[index + k]);
	// Before the fix-up, which then reads the fixed-up bytes.
	settleSublistSeparator(body.children, index);
	const settled = fixUpWrite(
		body,
		{ index, previous: { ...node, raw: spill.rawBefore }, text: node.raw },
		replacePreservingFirst(index, 1, blocks.length),
		grammar,
		sharing
	);
	const { change } = settled;
	const stands =
		change.op === 'replace' && change.at === index && body.children[index].kind === node.kind;
	fold.push(change, settledCaretPosition(settled, index, 0, body.children), stands);
	return true;
}

/**
 * One fold of `slot`'s list: `capture` keeps the list as it stood, for rollback, and `push` is the
 * one place a fold is reported, held there to the lines the list spelled before it.
 */
function foldWrite(slot: Pick<ChainSlot, 'body' | 'owner' | 'depth'>, folds: AncestrySeamFold[]) {
	const { body } = slot;
	let before: CstNode[] | null = null;
	let held: string | null = null;
	return {
		capture(): void {
			if (before) return;
			before = body.children.slice();
			if (devChecksOn) held = foldedBytes(body);
		},
		push(change: StructuralChange, landing: TrackedPosition, keepsPaths = false): void {
			// A fold follows a write, so the capture ran first.
			folds.push({
				depth: slot.depth,
				siblings: body.children,
				owner: slot.owner,
				change,
				before: before!,
				landing,
				keepsPaths
			});
			assertInvariant('fold-keeps-lines', () => checkFoldKeepsLines(held, foldedBytes(body)));
		}
	};
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

/** Whether the write changed only the title on the container's title row, which no metadata comes
 *  from; a change to the row's marker (the `:::name` of an opener line) can change the kind. */
function onlyTitleChanged(node: CstNode, changed: ChildRawChange): boolean {
	const chromeKind = reservedChromeKindOf(node.kind);
	const row = node.children?.[0];
	if (changed.index !== 0 || chromeKind === undefined || row?.kind !== chromeKind) return false;
	return rowMarker(node, row) === rowMarker(node, { ...row, raw: changed.previousRaw });
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
	 *  asked when its own line moved, and both when the position took another kind. */
	above: boolean;
	below: boolean;
}

/**
 * Check the joins at a rebuilt container's position, since its new bytes can stop interrupting
 * a neighbour; the window passed below covers exactly the sides the slot names.
 */
function settleSlotSeams(
	slot: ChainSlot,
	sharing: SharingState,
	folds: AncestrySeamFold[],
	grammar: GrammarView
): void {
	const { body, index, above, below } = slot;
	// The rollback snapshot is captured only once a merge is certain, since a copy costs
	// O(children) reactive reads on every keystroke inside a large container.
	const fold = foldWrite(slot, folds);
	const landing: TrackedPosition = { index, offset: 0 };
	const change = mergeJoinsAt(
		body,
		above ? index : index + 1,
		above && below ? 1 : 0,
		grammar,
		sharing,
		landing,
		fold.capture
	);
	if (change.op !== 'noop') fold.push(change, landing);
}

/** Whether `owner`'s children are blocks: an item or a row is none, so no wait runs into one. */
function holdsBlocks(owner: CstNode | null): boolean {
	const lines = owner && blockFacts(owner.kind).lines;
	return lines !== 'items' && lines !== 'rows';
}

/** Reads again from a block above the rebuilt container that waits where it starts, under a
 *  reading no line closes: the container's new bytes can change that block. */
function settleSlotWait(
	slot: Pick<ChainSlot, 'body' | 'owner' | 'depth' | 'index'>,
	openerMoved: boolean,
	sharing: SharingState,
	folds: AncestrySeamFold[],
	grammar: GrammarView
): void {
	const { body, index } = slot;
	const siblings = body.children;
	// A first line that moved can end a wait itself; below it, only a wait that ran past it matters.
	if (!openerMoved && !waitsInto(siblings, index, unfinishedReadings(grammar))) return;
	const fold = foldWrite(slot, folds);
	const landing: TrackedPosition = { index, offset: 0 };
	const change = rereadWaitAt(body, index, grammar, sharing, landing, fold.capture);
	if (change.op !== 'noop') fold.push(change, landing);
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
