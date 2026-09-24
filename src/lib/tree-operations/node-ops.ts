/**
 * The split and merge primitives, the two ops that re-divide a body's blocks around a caret,
 * plus the cleanup every destructive join goes through (live-mode.md § 4.5). They mutate and
 * report; the commit sequence recomputes the separators around them (`settle.ts`).
 */

import { DEV } from 'esm-env';
import { headingLevel, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph, isBlankSource, parse } from '../core/parser';
import type { GrammarView } from '../schema/block-openers';
import {
	getLiveJoinSeamCleaner,
	getLiveSplitRebalancer,
	type CleanedJoin,
	type InlineResolverRef,
	type JoinSeam
} from '../schema/inline-construct-policy';
import type { PresentationMode } from '../presentation-mode';
import {
	displayLength,
	snapToScalarBoundary,
	terminateLine,
	trailingLineEnding,
	trimTrailingLineEnding
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
import { checkSplitLanding } from '../invariants/split-landing';
import {
	NEXT_PROSE_LINE,
	ensureEditableContainers,
	forBody,
	normalizeOwnRaw,
	type BodyParentArg,
	type NodeParent
} from './node-primitives';
import { absorbSeamReading, deleteNode } from './settle';
import { adoptReparsedFields, probeLineOpensAsProse } from './content-write';
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';

// ── Split ──

/** What a split reports: the structural splice, plus where the second half's head ended up,
 *  past `blockIndex + 1` when the first half reparsed to several blocks. */
export interface SplitResult {
	change: StructuralChange;
	secondHalfIndex: number;
}

/**
 * The caret index a caller is about to use must be the one the split reported (G1.34): a caller
 * that re-derives `blockIndex + 1` itself warns here instead of going wrong quietly.
 */
export function assertSplitLanding(split: SplitResult, landing: number): void {
	assertInvariant('split-landing', () => checkSplitLanding(split.secondHalfIndex, landing));
}

/**
 * A write target that holds one block must receive exactly one (G1.35). Checked at the write
 * with the nodes being written, so a new write target inherits the check.
 */
export function assertSingleNodeSink(sink: string, installed: readonly CstNode[]): void {
	assertInvariant('single-node-sink', () => checkSingleNodeSink(sink, installed.length));
}

/**
 * Split the node at `blockIndex` at raw `offset` (display-relative). The first half inherits the
 * original ID and the whole structural suffix (a setext underline); the second half opens with a
 * blank separator wherever one does structural work ({@link separatorSplitsOffNextLine}).
 * A caller that moves the second half elsewhere passes how its new position reads it.
 */
export function splitNode(
	parent: BodyParentArg,
	blockIndex: number,
	offset: number,
	sharing: SharingState | undefined,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	grammar?: GrammarView,
	readSecondHalf: FragmentReader = fragmentReaderAt(
		ownerAt(parent, [blockIndex]),
		blockIndex + 1,
		grammar
	)
): SplitResult {
	const noop: SplitResult = { change: { op: 'noop' }, secondHalfIndex: blockIndex + 1 };
	if (blockIndex < 0 || blockIndex >= parent.children.length) return noop;

	const node = parent.children[blockIndex];
	const descriptor = getBlockKindDescriptor(node.kind);

	// A context-dependent kind (a table cell, a container's title child) has no standalone
	// recognizer, so the reparse would destroy both halves.
	if (descriptor.contextDependentKind) return noop;

	const rawText = node.raw;
	const lineEnding = trailingLineEnding(rawText);
	const cut = headingHeadCut(descriptor, node, cutPastLineEnding(descriptor, node, offset));

	const suffixSplit = structuralSuffixSplit(descriptor, node, cut);
	// Both halves are escaped: each can collide with the container's syntax alone (a `</details>`
	// stranded on the second half, or a first half that becomes a bare closer once its trailing
	// text is cut away).
	let firstRaw = forBody(parent, suffixSplit ? suffixSplit.firstRaw : rawText.slice(0, cut));
	let secondRaw = forBody(parent, suffixSplit ? suffixSplit.secondRaw : rawText.slice(cut));

	firstRaw = terminateLine(firstRaw, rawText);
	secondRaw = terminateLine(secondRaw, rawText);

	// Only live mode rebalances: there the delimiters around the cut are hidden, so a byte-literal
	// half would show runs the user never saw. The rebalancer declines when its bytes do not
	// parse back, leaving the literal cut every other mode gets.
	if (presentationMode === 'live') {
		const rebalanced = getLiveSplitRebalancer()?.(node, offset, firstRaw, secondRaw, linkRef);
		if (rebalanced) {
			firstRaw = rebalanced.firstRaw;
			secondRaw = rebalanced.secondRaw;
			// The rewrite verifies each half on its own, where a missing final line ending is
			// legal; side by side the halves would share a line and rejoin on reload.
			firstRaw = terminateLine(firstRaw, rawText);
			secondRaw = terminateLine(secondRaw, rawText);
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
		fragmentReaderAt(ownerAt(parent, [blockIndex]), blockIndex, grammar)
	);
	// The blank line the parse split off the first half stands between the halves, so it is the
	// second half's separator; `separator` is empty when the bytes already end in a blank line.
	const second = reparseAsNodes(secondRaw, first.suffix + separator, readSecondHalf);
	if (DEV && first.nodes.length > 1) {
		// Legal, since the result carries the caret index, but rare enough to keep visible.
		devWarn('tree-ops', `splitNode: the first half parsed to ${first.nodes.length} blocks`);
	}

	const nodes = [...first.nodes, ...second.nodes];
	// The blank line split off the second half has no follower inside the splice, so it stays
	// in raw.
	nodes[nodes.length - 1].raw += second.suffix;
	const splitTail = blockIndex === parent.children.length - 1;
	parent.children.splice(blockIndex, 1, ...nodes);
	// The merge window starts at the join itself: a wider one would reach back into the spliced
	// set and break the one-window accounting. At the tail, the document's trailing blank line
	// is the separator fix-up's to handle.
	const seamLeft = blockIndex + nodes.length - 1;
	const eaten = splitTail ? 0 : absorbSeamReading(parent, seamLeft, seamLeft, sharing).eaten;
	return {
		change: replacePreservingFirst(blockIndex, 1 + eaten, nodes.length),
		secondHalfIndex: blockIndex + first.nodes.length
	};
}

/**
 * The cut a split makes: a line ending the offset lands on ends the first half rather than
 * opening the second, which would create a blank line nobody typed. A CRLF is one boundary, and
 * the cut clamps to a content range's end.
 */
function cutPastLineEnding(descriptor: BlockKindDescriptor, node: CstNode, offset: number): number {
	const raw = node.raw;
	// A surrogate pair is one boundary too: a cut through it leaves each half in a block of its
	// own, where nothing can put them back.
	const at = snapToScalarBoundary(raw, offset);
	const ending = raw[at] === '\n' ? '\n' : raw.startsWith('\r\n', at) ? '\r\n' : '';
	if (ending === '') return at;
	const contentEnd = descriptor.getContentRange?.(node).end;
	return contentEnd === undefined ? at + ending.length : Math.min(at + ending.length, contentEnd);
}

/**
 * Enter at the head of an ATX heading's text moves the whole heading down under a new empty
 * line: the marker belongs with its text, and an empty heading is nothing anyone asked for.
 */
function headingHeadCut(descriptor: BlockKindDescriptor, node: CstNode, cut: number): number {
	const content = headingLevel(node) === null ? undefined : descriptor.getContentRange?.(node);
	if (!content || content.start === 0 || content.end === content.start) return cut;
	return cut <= content.start ? 0 : cut;
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
	grammar: GrammarView | undefined
): string {
	if (isBlankSource(secondRaw)) {
		const trivia = blankBlockTrivia(isBlankSource(firstRaw), successor, lineEnding);
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
	grammar: GrammarView | undefined
): boolean {
	return (
		parse(firstRaw + lineEnding + secondRaw, { grammar, scope: 'fragment' }).children.length >
		parse(firstRaw + secondRaw, { grammar, scope: 'fragment' }).children.length
	);
}

/**
 * Would a blank line between `raw` and the line after it split off a second block? Asked of the
 * bytes, never a kind list, so the separator never lands inside a body that swallows both forms.
 * Blank blocks are not counted on either side, or the answer would be yes for every raw.
 */
function separatorSplitsOffNextLine(
	raw: string,
	secondRaw: string,
	lineEnding: string,
	grammar: GrammarView | undefined
): boolean {
	if (DEV && !probeLineOpensAsProse(grammar)) {
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

function contentBlockCount(source: string, grammar: GrammarView | undefined): number {
	return parse(source, { grammar, scope: 'fragment' }).children.filter(
		(node) => !isBlankParagraph(node)
	).length;
}

/**
 * A split that keeps a kind's structural suffix (raw beyond its content range, the setext
 * underline) on the first half. Null when the kind has no suffix, or the offset is at block
 * start or inside the suffix itself.
 */
function structuralSuffixSplit(
	descriptor: BlockKindDescriptor,
	node: CstNode,
	offset: number
): { firstRaw: string; secondRaw: string } | null {
	const getRange = descriptor.getContentRange;
	if (!getRange) return null;
	const raw = node.raw;
	const contentEnd = getRange(node).end;
	if (contentEnd >= displayLength(raw) || offset <= 0 || offset > contentEnd) return null;
	// A remainder opening with a whitespace-only line reloads as blank: the cut
	// consumes that whitespace into the first half, as it does a bare line ending.
	const wsLine = /^[ \t]+\r?\n/.exec(raw.slice(offset, contentEnd))?.[0] ?? '';
	return {
		// The retained suffix opens with the ending of the line it follows, so a cut sitting
		// just past one would double it into a blank line and strand the suffix below.
		firstRaw:
			trimTrailingLineEnding(raw.slice(0, offset) + trimTrailingLineEnding(wsLine)) +
			raw.slice(contentEnd),
		secondRaw: raw.slice(offset + wsLine.length, contentEnd)
	};
}

// ── Merge ──

/**
 * `join.mergedRaw` with the delimiter runs the join left unpaired at the join point dropped, in
 * live mode only (live-mode.md § 4.5). The one registered cleaner verifies its own bytes and
 * otherwise declines, leaving the literal join every other mode gets. Every destructive join
 * goes through here.
 */
export function cleanJoinedRaw(
	join: JoinSeam,
	presentationMode: PresentationMode | undefined
): CleanedJoin {
	const literal = { raw: join.mergedRaw, seam: join.seam };
	if (presentationMode !== 'live') return literal;
	return getLiveJoinSeamCleaner()?.(join) ?? literal;
}

/**
 * The bytes a single-block edit leaves when it deletes `range` out of `display`. A delete-then-
 * insert is a join like any other, so it goes through the same cleanup, and the returned offset
 * is where the two sides now meet.
 */
export function cutRangeFromDisplay(
	node: NodeView,
	display: string,
	range: { start: number; end: number },
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef
): { display: string; offset: number } {
	// Both ends are moved off the middle of a surrogate pair before the slice: half a pair here
	// is unrecoverable bytes, not a recoverable edit. Snapping both the same direction cannot
	// invert the range.
	const start = snapToScalarBoundary(display, range.start);
	const end = snapToScalarBoundary(display, range.end);
	if (start >= end) return { display, offset: start };
	const cleaned = cleanJoinedRaw(
		{
			mergedRaw: display.slice(0, start) + display.slice(end),
			seam: start,
			start: { node, offset: start },
			end: { node, offset: end },
			linkRef
		},
		presentationMode
	);
	return { display: cleaned.raw, offset: cleaned.seam };
}

/** The bytes two adjacent blocks make when one absorbs the other, join cleanup included. */
function joinRaw(
	prev: NodeView,
	curr: NodeView,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef
): CleanedJoin {
	const seam = displayLength(prev.raw);
	return cleanJoinedRaw(
		{
			mergedRaw: prev.raw.slice(0, seam) + curr.raw,
			seam,
			start: { node: prev, offset: seam },
			end: { node: curr, offset: 0 },
			linkRef
		},
		presentationMode
	);
}

/** What a join reports: the structural splice, plus where the two blocks met in the survivor's
 *  bytes, which the join cleanup moves when it drops a run on the first block's side. */
export interface MergeResult {
	change: StructuralChange;
	joinOffset: number;
}

/**
 * `targetPath` is relative to `parent.children[blockIndex - 1]`: empty means prev itself
 * is the leaf, non-empty walks into prev's container subtree.
 */
export interface MergeIntoPrevResult {
	targetPath: number[];
	joinOffset: number;
	change: StructuralChange;
}

/**
 * Merge `curr` into the deepest prose leaf of `prev`, writing into that leaf rather than
 * reparsing concatenated raw, which preserves prev's component identity and IME state. Null when
 * no mergeable leaf exists, so the caller can fall back to move-focus.
 */
export function mergeIntoPrevDeepLeaf(
	parent: BodyParentArg,
	blockIndex: number,
	sharing: SharingState | undefined,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	grammar?: GrammarView
): MergeIntoPrevResult | null {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return null;

	const mergeTarget = findMergeTarget(parent.children[blockIndex - 1]);
	if (!mergeTarget) return null;

	const leafPath = [blockIndex - 1, ...mergeTarget.path];
	const slot = leafPath[leafPath.length - 1];
	// The decision is read off the live tree before any copy-on-write: copying the ancestors is
	// a write, and a refused join must leave the pair exactly as it stands.
	const target = holderChildrenAt(parent.children, leafPath)[slot];
	const curr = parent.children[blockIndex];
	const lineEnding = trailingLineEnding(target.raw);
	const { raw: mergedRaw, seam: joinOffset } = joinRaw(target, curr, presentationMode, linkRef);
	const read = fragmentReaderAt(ownerAt(parent, leafPath), slot, grammar);
	const merged = mergedLeafFor(target, trimTrailingLineEnding(mergedRaw) + lineEnding, read);
	if (!merged) return null;

	// The merge writes the deep leaf's raw plus every ancestor's rebuilt raw, so copy the whole
	// ancestor chain first and resolve through the owned copies.
	if (sharing) ensureUnsharedPath(parent, leafPath, sharing);
	// Write, then re-read through the tree (`unshare.ts` header), down to the leaf's own position
	// so a kind change can put a new node there.
	installMergedLeaf(holderChildrenAt(parent.children, leafPath), slot, merged, sharing);
	if (mergeTarget.path.length > 0) {
		rebuildAncestryRaw(parent.children[blockIndex - 1], mergeTarget.path);
	}

	const change = deleteNode(parent, blockIndex, sharing);
	return { targetPath: mergeTarget.path, joinOffset, change };
}

/** The container holding `path`'s last index: the parent's own owner for a one-step path. */
function ownerAt(parent: BodyParentArg, path: number[]): CstNode | undefined {
	if (path.length === 1) return 'owner' in parent ? parent.owner : undefined;
	let owner = parent.children[path[0]];
	for (const index of path.slice(1, -1)) owner = owner.children![index];
	return owner;
}

/** The children array holding `path`'s last index, walked from `children`. */
function holderChildrenAt(children: CstNode[], path: number[]): CstNode[] {
	let holder = children;
	for (const index of path.slice(0, -1)) holder = holder[index].children!;
	return holder;
}

/** What the deep-leaf write installs: the legal bytes, plus their reparse where the kind has
 *  one. The parsed blocks are passed whole rather than as their first, so the install can check
 *  it received one (G1.35). */
interface MergedLeaf {
	written: string;
	blocks: readonly CstNode[];
}

/**
 * The deep-leaf merge's decision: the absorbed bytes pass through the kind's own write rule and
 * a fragment reparse. Null when they read as several blocks, since the leaf holds one (G1.35).
 */
function mergedLeafFor(target: CstNode, raw: string, read: FragmentReader): MergedLeaf | null {
	const written = normalizeOwnRaw(target, raw);
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
	sharing: SharingState | undefined
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
		ensureEditableContainers(parsed);
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
 * Merge the node at `blockIndex` with its successor; combined raw is re-parsed in the editor's
 * grammar and the merged block inherits the current block's ID. Noop at the tail.
 */
export function mergeWithNext(
	parent: NodeParent,
	blockIndex: number,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	grammar: GrammarView | undefined
): MergeResult {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) {
		return { change: { op: 'noop' }, joinOffset: 0 };
	}

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	const { raw: mergedRaw, seam } = joinRaw(curr, next, presentationMode, linkRef);
	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia, grammar);
	if (!mergedNode) return { change: { op: 'noop' }, joinOffset: 0 };
	const installed = [mergedNode];
	assertSingleNodeSink('mergeWithNext', installed);
	parent.children.splice(blockIndex, 2, ...installed);
	return { change: replacePreservingFirst(blockIndex, 2, 1), joinOffset: seam };
}

// ── Reparse helper (private) ──

/**
 * Reparse a half's bytes as the blocks they hold, plus the trailing blank line the fragment
 * parse splits off into `doc.suffix`: every caller must put it somewhere, or the bytes are lost.
 */
function reparseAsNodes(
	raw: string,
	leadingTrivia: string,
	read: FragmentReader
): { nodes: CstNode[]; suffix: string } {
	const doc = read(raw);
	if (doc.children.length === 0) {
		return { nodes: [{ kind: 'paragraph', leadingTrivia, raw }], suffix: doc.suffix };
	}
	doc.children[0].leadingTrivia = leadingTrivia;
	for (const node of doc.children) ensureEditableContainers(node);
	return { nodes: doc.children, suffix: doc.suffix };
}

/**
 * The single-block counterpart for the merges: a join whose bytes read as several blocks does
 * not fit one position, so null refuses it rather than truncating (G1.35).
 */
function reparseAsNode(
	raw: string,
	leadingTrivia: string,
	grammar: GrammarView | undefined
): CstNode | null {
	const { nodes, suffix } = reparseAsNodes(raw, leadingTrivia, (text) =>
		parse(text, { grammar, scope: 'fragment' })
	);
	if (nodes.length > 1) return null;
	// A single-block write has no follower to give the split-off blank line to, so it stays in
	// the block's bytes.
	nodes[0].raw += suffix;
	return nodes[0];
}
