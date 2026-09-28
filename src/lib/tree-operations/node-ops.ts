/**
 * Split and merge, the two operations that re-divide a body's blocks around a caret. They mutate
 * and report; the commit recomputes the separators around them.
 */

import { isDevChecks } from '../env';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph, readBlocks } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import { getLiveSplitRebalancer } from '../schema/inline-construct-policy';
import type { Reading } from '../schema/reading';
import type { StoredAs } from '../schema/stored-as';
import {
	displayLength,
	isBlankText,
	lineEndingAt,
	snapToScalarBoundary,
	terminateLine,
	trailingLineEnding,
	type LineEnding
} from '../core/lines';
import { devWarn } from '../dev-warn';
import { assignChildIdsDeep } from '../block-id';
import { findMergeTarget } from '../schema/merge-rules';
import { rebuildAncestryRaw } from '../schema/container-raw';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { ensureUnsharedPath } from './unshare';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { assertInvariant } from '../assert';
import { checkSingleNodeSink } from '../invariants/single-node-sink';
import {
	NEXT_PROSE_LINE,
	ensureEditableContainers,
	forBody,
	parentLineEnding,
	type BodyParentArg
} from './node-primitives';
import { absorbSeamReading, deleteNode, type TrackedPosition } from './settle';
import { cutKeepingStructure } from './structural-suffix';
import { leafAtRawOffset, rawOffsetOfLeaf } from './container-offsets';
import { CURSOR_END } from '../block-component';
import { adoptReparsedFields, legalizeWrite, probeLineOpensAsProse } from './content-write';
import { writeKeepingTaskMarker } from './list/reconcile-task';
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';
import { storedAsIn } from './stored-as';
import { cleanJoinedRaw, joinLeaves } from './leaf-range';

// ── Split ──

/** What a split reports: the structural splice, plus where the second half's head ended up,
 *  past `blockIndex + 1` when the first half reparsed to several blocks. */
export interface SplitResult {
	change: StructuralChange;
	secondHalfIndex: number;
}

/**
 * A write target that holds one block must receive exactly one; checking at the write means a
 * new write target inherits the check (G1.35).
 */
export function assertSingleNodeSink(sink: string, installed: readonly CstNode[]): void {
	assertInvariant('single-node-sink', () => checkSingleNodeSink(sink, installed.length));
}

/**
 * Split the node at `blockIndex` at `offset`; the first half keeps the ID and any setext underline.
 * A caller moving the second half elsewhere passes `readSecondHalf` for that position.
 */
export function splitNode(
	parent: BodyParentArg,
	blockIndex: number,
	offset: number,
	sharing: SharingState | undefined,
	reading: Reading,
	readSecondHalf: FragmentReader = fragmentReaderAt(
		ownerAt(parent, [blockIndex]),
		blockIndex + 1,
		reading.grammar
	)
): SplitResult {
	const { grammar } = reading;
	const noop: SplitResult = { change: { op: 'noop' }, secondHalfIndex: blockIndex + 1 };
	if (blockIndex < 0 || blockIndex >= parent.children.length) return noop;

	const node = parent.children[blockIndex];
	const descriptor = getBlockKindDescriptor(node.kind);

	// A context-dependent kind (a table cell, a container's title child) has no standalone
	// recognizer, so the reparse would destroy both halves.
	if (descriptor.contextDependentKind) return noop;

	const lineEnding = trailingLineEnding(node.raw, parentLineEnding(parent));
	const { head, rest } = cutKeepingStructure(node, cutPastLineEnding(descriptor, node, offset));
	// Both halves are escaped: either can collide with the container's syntax alone (a stranded
	// `</details>`, or a first half that is a bare closer once its trailing text is cut away).
	let firstRaw = forBody(parent, head);
	let secondRaw = forBody(parent, rest);

	firstRaw = terminateLine(firstRaw, lineEnding);
	secondRaw = terminateLine(secondRaw, lineEnding);

	// Only a block that hides its delimiters rebalances, since a literal half would show runs the
	// user never saw; the rebalancer declines when its bytes do not parse back.
	if (reading.hidesDelimitersAtCaret()) {
		const rebalanced = getLiveSplitRebalancer()?.(node, offset, firstRaw, secondRaw, reading);
		if (rebalanced) {
			firstRaw = rebalanced.firstRaw;
			secondRaw = rebalanced.secondRaw;
			// The rewrite verifies each half on its own, where a missing final line ending is
			// legal; side by side the halves would share a line and rejoin on reload.
			firstRaw = terminateLine(firstRaw, lineEnding);
			secondRaw = terminateLine(secondRaw, lineEnding);
		}
	}

	const separator = splitSeparator(
		firstRaw,
		secondRaw,
		lineEnding,
		parent.children[blockIndex + 1],
		grammar
	);
	const first = reparseAsNodes(
		firstRaw,
		node.leadingTrivia,
		fragmentReaderAt(ownerAt(parent, [blockIndex]), blockIndex, grammar),
		lineEnding
	);
	// The blank line the parse split off the first half stands between the halves, so it is the
	// second half's separator; `separator` is empty when the bytes already end in a blank line.
	const second = reparseAsNodes(secondRaw, first.suffix + separator, readSecondHalf, lineEnding);
	if (isDevChecks() && first.nodes.length > 1) {
		// Legal, since the result carries the caret index, but rare enough to keep visible.
		devWarn('tree-ops', `splitNode: the first half parsed to ${first.nodes.length} blocks`);
	}

	const nodes = [...first.nodes, ...second.nodes];
	// The blank line split off the second half has no follower inside the splice, so it stays
	// in raw.
	nodes[nodes.length - 1].raw += second.suffix;
	const splitTail = blockIndex === parent.children.length - 1;
	parent.children.splice(blockIndex, 1, ...nodes);
	// The merge window starts at the join, since a wider one would reach back into the spliced
	// set; at the tail the document's trailing blank line is left to the separator fix-up.
	const seamLeft = blockIndex + nodes.length - 1;
	const eaten = splitTail
		? 0
		: absorbSeamReading(parent, seamLeft, seamLeft, grammar, sharing).eaten;
	return {
		change: replacePreservingFirst(blockIndex, 1 + eaten, nodes.length),
		secondHalfIndex: blockIndex + first.nodes.length
	};
}

/**
 * A line ending at the cut ends the first half rather than opening the second, which would
 * create a blank line nobody typed; a CRLF counts as one boundary.
 */
function cutPastLineEnding(descriptor: BlockKindDescriptor, node: CstNode, offset: number): number {
	const raw = node.raw;
	// A surrogate pair is one boundary too: a cut through it leaves each half in a block of its
	// own, where nothing can put them back.
	const at = snapToScalarBoundary(raw, offset);
	const ending = lineEndingAt(raw, at);
	if (ending === '') return at;
	const contentEnd = descriptor.getContentRange?.(node).end;
	return contentEnd === undefined ? at + ending.length : Math.min(at + ending.length, contentEnd);
}

/**
 * The separator for a newly created blank block: a blank line is a block only past its run's
 * first line, so it separates from a non-blank predecessor unless a run is already open below.
 */
function blankBlockTrivia(
	predecessorIsBlank: boolean,
	successor: CstNode | undefined,
	lineEnding: string
): string {
	if (predecessorIsBlank) return '';
	const runOpenBelow =
		successor !== undefined && (successor.leadingTrivia !== '' || isBlankParagraph(successor));
	return runOpenBelow ? '' : lineEnding;
}

/**
 * The second half's separator: a blank half follows {@link blankBlockTrivia}; a prose half takes
 * a separator exactly when lazy continuation would join the halves back together.
 */
function splitSeparator(
	firstRaw: string,
	secondRaw: string,
	lineEnding: string,
	successor: CstNode | undefined,
	grammar: GrammarView
): string {
	if (isBlankText(secondRaw)) {
		const trivia = blankBlockTrivia(isBlankText(firstRaw), successor, lineEnding);
		// A body that swallows blank lines (an unclosed fence) takes the separator inside
		// itself and gains nothing, so ask the bytes rather than assume.
		const becomesBlock = blankHalfBecomesBlock(firstRaw, secondRaw, lineEnding, grammar);
		return trivia !== '' && becomesBlock ? trivia : '';
	}
	return separatorSplitsOffNextLine(firstRaw, secondRaw, lineEnding, grammar) ? lineEnding : '';
}

function blankHalfBecomesBlock(
	firstRaw: string,
	secondRaw: string,
	lineEnding: string,
	grammar: GrammarView
): boolean {
	return (
		readBlocks(firstRaw + lineEnding + secondRaw, { grammar, scope: 'fragment' }).children.length >
		readBlocks(firstRaw + secondRaw, { grammar, scope: 'fragment' }).children.length
	);
}

/**
 * Whether a blank line after `raw` would split off a second block, asked of the bytes rather than
 * a kind list so the separator never lands inside a body that swallows blank lines.
 */
function separatorSplitsOffNextLine(
	raw: string,
	secondRaw: string,
	lineEnding: string,
	grammar: GrammarView
): boolean {
	if (isDevChecks() && !probeLineOpensAsProse(grammar)) {
		devWarn(
			'tree-ops',
			`a registered opener claims ${JSON.stringify(NEXT_PROSE_LINE)}, so the split-separator probe no longer stands in for prose`
		);
	}
	// Both lines that will ever sit under `raw`: the second half's actual head (a promoted table
	// absorbs a pipe-bearing one), and the prose stand-in for whatever a later edit puts there.
	const probes = [secondRaw.slice(0, secondRaw.indexOf('\n') + 1), NEXT_PROSE_LINE + lineEnding];
	return probes.some(
		(probe) =>
			contentBlockCount(raw + lineEnding + probe, grammar) > contentBlockCount(raw + probe, grammar)
	);
}

/** Blank blocks don't count, or a blank line would split a block off every raw. */
function contentBlockCount(source: string, grammar: GrammarView): number {
	return readBlocks(source, { grammar, scope: 'fragment' }).children.filter(
		(node) => !isBlankParagraph(node)
	).length;
}

// ── Merge ──

/**
 * The bytes a single-block edit leaves when it deletes `range` from `display`, cleaned like any
 * join against where `store` keeps them; the returned offset is where the two sides meet.
 */
export function cutRangeFromDisplay(
	node: NodeView,
	display: string,
	range: { start: number; end: number },
	store: StoredAs
): { display: string; offset: number } {
	// Both ends snap off the middle of a surrogate pair, since half a pair can't be recovered;
	// snapping both in the same direction cannot invert the range.
	const start = snapToScalarBoundary(display, range.start);
	const end = snapToScalarBoundary(display, range.end);
	if (start >= end) return { display, offset: start };
	const cleaned = cleanJoinedRaw({
		mergedRaw: display.slice(0, start) + display.slice(end),
		seam: start,
		start: { node, offset: start },
		end: { node, offset: end },
		typed: '',
		store
	});
	return { display: cleaned.raw, offset: cleaned.seam };
}

/** What a join reports: the structural splice, plus where the two blocks met in the survivor's
 *  bytes, which the join cleanup moves when it drops a run on the first block's side. */
export interface MergeResult {
	change: StructuralChange;
	joinOffset: number;
}

/** Where the join landed: the block at `index` in the parent, and the leaf at `targetPath` below
 *  it (empty when that block is the leaf). The index is `blockIndex - 1` unless the fix-up after
 *  the delete merged that block into the one above it. */
export interface MergeIntoPrevResult {
	index: number;
	targetPath: number[];
	joinOffset: number;
	change: StructuralChange;
}

/** Join `absorbed`'s text onto the end of the leaf at `path`, leaving `absorbed` for the caller to
 *  remove; null, writing nothing, when the joined bytes read as several blocks. */
export function joinIntoLeaf(
	parent: BodyParentArg,
	path: readonly number[],
	absorbed: NodeView,
	reading: Reading,
	sharing: SharingState | undefined
): { joinOffset: number } | null {
	const slot = path[path.length - 1];
	// The decision is read off the live tree before any copy-on-write: copying the ancestors is
	// a write, and a refused join must leave the pair exactly as it stands.
	const holder = {
		children: holderChildrenAt(parent.children, path),
		owner: ownerAt(parent, path),
		lineEnding: parentLineEnding(parent)
	};
	const target = holder.children[slot];
	const { raw, seam } = joinLeaves(
		{ node: target, offset: displayLength(target.raw) },
		{ node: absorbed, offset: 0 },
		'',
		storedAsIn(holder, slot, reading)
	);
	const legal = legalizeWrite(holder, slot, raw, 'literal');
	const merged = mergedLeafFor(
		target,
		legal.text,
		fragmentReaderAt(holder.owner, slot, reading.grammar)
	);
	if (!merged) return null;

	// The join writes the leaf's raw plus every ancestor's rebuilt raw, so copy the whole
	// ancestor chain first and resolve through the owned copies (`unshare.ts` header).
	if (sharing) ensureUnsharedPath(parent, [...path], sharing);
	const children = holderChildrenAt(parent.children, path);
	// The task state is reconciled before the ancestors' rebuild writes the list item's marker.
	writeKeepingTaskMarker(ownerAt(parent, path), children, slot, sharing, () =>
		installMergedLeaf(children, slot, merged, sharing, holder.lineEnding)
	);
	if (path.length > 1) rebuildAncestryRaw(parent.children[path[0]], path.slice(1), reading.grammar);
	return { joinOffset: legal.storedOffset(seam) };
}

/**
 * Merge `curr` into `prev`'s deepest prose leaf, writing into the leaf so it keeps its component
 * and IME state. Null when no leaf can take it, so the caller moves focus instead.
 */
export function mergeIntoPrevDeepLeaf(
	parent: BodyParentArg,
	blockIndex: number,
	sharing: SharingState | undefined,
	reading: Reading
): MergeIntoPrevResult | null {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return null;

	const mergeTarget = findMergeTarget(parent.children[blockIndex - 1]);
	if (!mergeTarget) return null;

	const leafPath = [blockIndex - 1, ...mergeTarget.path];
	const curr = parent.children[blockIndex];
	const merged = joinIntoLeaf(parent, leafPath, curr, reading, sharing);
	if (!merged) return null;

	const { joinOffset } = merged;
	const joined: JoinLanding = { index: blockIndex - 1, targetPath: mergeTarget.path, joinOffset };
	const at = rawOffsetOfLeaf(parent.children[blockIndex - 1], mergeTarget.path, joinOffset);
	const tracked = at === null ? undefined : { index: blockIndex - 1, offset: at };
	const change = deleteNode(parent, blockIndex, reading.grammar, sharing, tracked);
	return { ...landingAfterFixUp(parent, joined, at, tracked), change };
}

type JoinLanding = Omit<MergeIntoPrevResult, 'change'>;

/** Where the join sits once the delete's fix-up has run: where it was, unless a merge of
 *  neighbours moved its bytes, and then the leaf now holding them. */
function landingAfterFixUp(
	parent: BodyParentArg,
	joined: JoinLanding,
	at: number | null,
	tracked: TrackedPosition | undefined
): JoinLanding {
	if (!tracked || (tracked.index === joined.index && tracked.offset === at)) return joined;
	const leaf = leafAtRawOffset(parent.children[tracked.index], tracked.offset);
	return leaf
		? { index: tracked.index, targetPath: leaf.path, joinOffset: leaf.offset }
		: { index: tracked.index, targetPath: [], joinOffset: CURSOR_END };
}

/** The container holding `path`'s last index: the parent's own owner for a one-step path. */
function ownerAt(parent: BodyParentArg, path: readonly number[]): CstNode | undefined {
	if (path.length === 1) return 'owner' in parent ? parent.owner : undefined;
	let owner = parent.children[path[0]];
	for (const index of path.slice(1, -1)) owner = owner.children![index];
	return owner;
}

/** The children array holding `path`'s last index, walked from `children`. */
function holderChildrenAt(children: CstNode[], path: readonly number[]): CstNode[] {
	let holder = children;
	for (const index of path.slice(0, -1)) holder = holder[index].children!;
	return holder;
}

/** What the leaf write installs: the legal bytes plus their reparse, passed whole so the install
 *  can check it received one block. */
interface MergedLeaf {
	written: string;
	blocks: readonly CstNode[];
}

/** The join's decision: the legal bytes' fragment reparse, or null when they read as several
 *  blocks, since the leaf holds one. */
function mergedLeafFor(target: CstNode, written: string, read: FragmentReader): MergedLeaf | null {
	// A context-dependent kind has no standalone recognizer, so its bytes are never read back
	// as blocks and the write keeps the kind.
	if (tryGetBlockKindDescriptor(target.kind)?.contextDependentKind) {
		return { written, blocks: [] };
	}
	const blocks = read(written).children;
	return blocks.length > 1 ? null : { written, blocks };
}

/** {@link mergedLeafFor}'s write, over the copied ancestor chain the decision was taken before. */
function installMergedLeaf(
	holderChildren: CstNode[],
	slot: number,
	merged: MergedLeaf,
	sharing: SharingState | undefined,
	ending: LineEnding
): void {
	const target = holderChildren[slot];
	const { written, blocks } = merged;
	assertSingleNodeSink('mergedLeafFor', blocks);
	const parsed = blocks[0];
	if (parsed && parsed.kind !== target.kind) {
		// The written bytes win over the reparse's split-off blank line: a one-block write target
		// keeps every byte.
		parsed.raw = written;
		parsed.leadingTrivia = target.leadingTrivia;
		ensureEditableContainers(parsed, ending);
		if (sharing) sharing.stamp(parsed);
		assignChildIdsDeep(parsed);
		holderChildren[slot] = parsed;
		return;
	}
	target.raw = written;
	if (!parsed) return;
	adoptReparsedFields(target, parsed);
}

/**
 * Merge the node at `blockIndex` with its successor through {@link joinIntoLeaf}, then remove the
 * successor. The merged block keeps the current block's ID. Noop at the tail or on a refused join.
 */
export function mergeWithNext(
	parent: BodyParentArg,
	blockIndex: number,
	reading: Reading,
	sharing: SharingState | undefined
): MergeResult {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) {
		return { change: { op: 'noop' }, joinOffset: 0 };
	}

	const next = parent.children[blockIndex + 1];
	const merged = joinIntoLeaf(parent, [blockIndex], next, reading, sharing);
	if (!merged) return { change: { op: 'noop' }, joinOffset: 0 };
	parent.children.splice(blockIndex + 1, 1);
	return { change: replacePreservingFirst(blockIndex, 2, 1), joinOffset: merged.joinOffset };
}

// ── Reparse helper (private) ──

/**
 * Reparse a half's bytes as the blocks they hold, plus the trailing blank line the fragment
 * parse splits off into `doc.suffix`: every caller must put it somewhere, or the bytes are lost.
 */
function reparseAsNodes(
	raw: string,
	leadingTrivia: string,
	read: FragmentReader,
	ending: LineEnding
): { nodes: CstNode[]; suffix: string } {
	const doc = read(raw);
	if (doc.children.length === 0) {
		return { nodes: [{ kind: 'paragraph', leadingTrivia, raw }], suffix: doc.suffix };
	}
	doc.children[0].leadingTrivia = leadingTrivia;
	for (const node of doc.children) ensureEditableContainers(node, ending);
	return { nodes: doc.children, suffix: doc.suffix };
}
