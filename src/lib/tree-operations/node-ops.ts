/**
 * The split and merge primitives, the two ops that re-tile a body's blocks around a caret, plus
 * the join cleanup every destructive join crosses (live-mode.md § 4.5). They mutate and report;
 * the settle around them is the ceremony's (`settle.ts`).
 */

import { DEV } from 'esm-env';
import type { CstNode } from '../core/nodes';
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

// ── Split ──

/** What a split leaves the caret: the structural splice, plus where the second half's head
 *  landed, past `blockIndex + 1` when the first half reparsed to several blocks. */
export interface SplitResult {
	change: StructuralChange;
	secondHalfIndex: number;
}

/**
 * The landing a site is about to consume, held to the primitive's answer (G1.34): a re-derived
 * `blockIndex + 1` warns instead of shipping.
 */
export function assertSplitLanding(split: SplitResult, landing: number): void {
	assertInvariant('split-landing', () => checkSplitLanding(split.secondHalfIndex, landing));
}

/**
 * What a one-slot sink is about to put in its slot, held to one node (G1.35). Asked at the WRITE
 * with the nodes being written, so the guard answers for sink N+1.
 */
export function assertSingleNodeSink(sink: string, installed: readonly CstNode[]): void {
	assertInvariant('single-node-sink', () => checkSingleNodeSink(sink, installed.length));
}

/**
 * Split the node at `blockIndex` at raw `offset` (display-relative). The first half inherits the
 * original ID and the whole structural suffix (a setext underline); the second half opens with a
 * blank separator wherever one does structural work ({@link separatorSplitsOffNextLine}).
 */
export function splitNode(
	parent: BodyParentArg,
	blockIndex: number,
	offset: number,
	sharing: SharingState | undefined,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): SplitResult {
	const noop: SplitResult = { change: { op: 'noop' }, secondHalfIndex: blockIndex + 1 };
	if (blockIndex < 0 || blockIndex >= parent.children.length) return noop;

	const node = parent.children[blockIndex];
	const descriptor = getBlockKindDescriptor(node.kind);

	// A context-dependent kind (tableCell, container chrome) has no standalone recognizer,
	// so the reparse would destroy both halves.
	if (descriptor.contextDependentKind) return noop;

	const rawText = node.raw;
	const lineEnding = trailingLineEnding(rawText);
	const cut = cutPastLineEnding(descriptor, node, offset);

	const suffixSplit = structuralSuffixSplit(descriptor, node, cut);
	// Both halves: each can collide alone (a `</details>` stranded on the second half, or
	// a first half promoted to a bare terminator once its trailing text is cut away).
	let firstRaw = forBody(parent, suffixSplit ? suffixSplit.firstRaw : rawText.slice(0, cut));
	let secondRaw = forBody(parent, suffixSplit ? suffixSplit.secondRaw : rawText.slice(cut));

	firstRaw = terminateLine(firstRaw, rawText);
	secondRaw = terminateLine(secondRaw, rawText);

	// Live alone rebalances: there the delimiters around the cut are unpainted, so a byte-literal
	// half would surface runs the reader never saw. The rebalancer declines when its bytes do not
	// parse back, leaving the literal cut every other mode gets.
	if (presentationMode === 'live') {
		const rebalanced = getLiveSplitRebalancer()?.(node, offset, firstRaw, secondRaw, linkRef);
		if (rebalanced) {
			firstRaw = rebalanced.firstRaw;
			secondRaw = rebalanced.secondRaw;
			// The rewrite verifies its halves STANDALONE, where a missing final ending is
			// legal; at the seam the halves would share a line and rejoin on reload.
			firstRaw = terminateLine(firstRaw, rawText);
			secondRaw = terminateLine(secondRaw, rawText);
		}
	}

	const separator = splitSeparator(
		firstRaw,
		secondRaw,
		lineEnding,
		parent.children[blockIndex + 1]
	);
	const first = reparseAsNodes(firstRaw, node.leadingTrivia);
	// The first half's peeled line stands between the halves, so it is the second half's
	// separator; `separator` answers no when the bytes already end in a blank line.
	const second = reparseAsNodes(secondRaw, first.suffix + separator);
	if (DEV && first.nodes.length > 1) {
		// Legal, since the landing index rides the result, but rare enough to keep visible.
		devWarn('tree-ops', `splitNode: the first half parsed to ${first.nodes.length} blocks`);
	}

	const nodes = [...first.nodes, ...second.nodes];
	// The second half's peeled line has no follower inside the splice, so it stays in raw.
	nodes[nodes.length - 1].raw += second.suffix;
	const splitTail = blockIndex === parent.children.length - 1;
	parent.children.splice(blockIndex, 1, ...nodes);
	// Floor at the seam itself: a wider window would reach back into the spliced set and break
	// the one-window accounting. At the tail the document's folded line is the settle funnel's.
	const seamLeft = blockIndex + nodes.length - 1;
	const eaten = splitTail ? 0 : absorbSeamReading(parent, seamLeft, seamLeft, sharing).eaten;
	return {
		change: replacePreservingFirst(blockIndex, 1 + eaten, nodes.length),
		secondHalfIndex: blockIndex + first.nodes.length
	};
}

/**
 * The cut a split makes: an ending the offset lands ON terminates the FIRST half rather than
 * opening the second, which would mint a blank line nobody typed. A CRLF is one boundary, and
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
 * Leading trivia for a freshly minted BLANK block: a blank line is a block only past its run's
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
 * The second half's leading trivia: a blank half follows {@link blankBlockTrivia}; a prose half
 * takes a separator exactly when lazy continuation would fold the halves back together.
 */
function splitSeparator(
	firstRaw: string,
	secondRaw: string,
	lineEnding: string,
	successor: CstNode | undefined
): string {
	if (isBlankSource(secondRaw)) {
		const trivia = blankBlockTrivia(isBlankSource(firstRaw), successor, lineEnding);
		// A body that swallows blank lines (an unclosed fence) takes the separator inside
		// itself and gains nothing, so ask the bytes rather than assume.
		return trivia !== '' && blankHalfBecomesBlock(firstRaw, secondRaw, lineEnding) ? trivia : '';
	}
	return separatorSplitsOffNextLine(firstRaw, secondRaw, lineEnding) ? lineEnding : '';
}

function blankHalfBecomesBlock(firstRaw: string, secondRaw: string, lineEnding: string): boolean {
	return (
		parse(firstRaw + lineEnding + secondRaw, { scope: 'fragment' }).children.length >
		parse(firstRaw + secondRaw, { scope: 'fragment' }).children.length
	);
}

/**
 * Would a blank line between `raw` and the line after it split off a second block? Asked of the
 * bytes, never a kind list, so the separator never lands inside a body that swallows both forms.
 * Blank blocks are discounted on both sides, or the separator would answer yes for every raw.
 */
function separatorSplitsOffNextLine(raw: string, secondRaw: string, lineEnding: string): boolean {
	if (DEV && !probeLineOpensAsProse()) {
		devWarn(
			'tree-ops',
			`a registered opener claims ${JSON.stringify(NEXT_PROSE_LINE)}, so the split-separator probe no longer stands in for prose`
		);
	}
	// Both lines that will ever sit under `raw`: the second half's actual head (a promoted table
	// absorbs a pipe-bearing one), and the prose stand-in for whatever a later edit puts there.
	const probes = [secondRaw.slice(0, secondRaw.indexOf('\n') + 1), NEXT_PROSE_LINE + lineEnding];
	return probes.some(
		(probe) => contentBlockCount(raw + lineEnding + probe) > contentBlockCount(raw + probe)
	);
}

function contentBlockCount(source: string): number {
	return parse(source, { scope: 'fragment' }).children.filter((node) => !isBlankParagraph(node))
		.length;
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
 * `join.mergedRaw` with the delimiter runs the join orphaned at its seam dropped, live only
 * (live-mode.md § 4.5). The one registered cleaner verifies its own bytes and otherwise declines,
 * leaving the literal join every other mode gets. Every destructive join crosses this door.
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
 * insert is a join like any other, so it crosses the same cleanup, and the returned offset is
 * where the two sides now meet.
 */
export function cutRangeFromDisplay(
	node: NodeView,
	display: string,
	range: { start: number; end: number },
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): { display: string; offset: number } {
	// Both ends off any scalar interior before the slice: a half-pair here is unrecoverable
	// bytes, not a recoverable edit. Snapping the same direction cannot invert the range.
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

/** The bytes two adjacent blocks make when one absorbs the other, seam cleanup included. */
function joinRaw(
	prev: NodeView,
	curr: NodeView,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
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

/** What a join leaves the caret: the structural splice, plus where the two blocks met in the
 *  survivor's bytes, which a seam cleanup moves when it drops a run on the first block's side. */
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
	linkRef: InlineResolverRef | undefined,
	grammar?: GrammarView
): MergeIntoPrevResult | null {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return null;

	const mergeTarget = findMergeTarget(parent.children[blockIndex - 1]);
	if (!mergeTarget) return null;

	const leafPath = [blockIndex - 1, ...mergeTarget.path];
	const slot = leafPath[leafPath.length - 1];
	// The verdict comes off the LIVE tree, ahead of the unshare: an unshared spine is a write,
	// and a refused join must leave the pair exactly as it stands.
	const target = holderChildrenAt(parent.children, leafPath)[slot];
	const curr = parent.children[blockIndex];
	const lineEnding = trailingLineEnding(target.raw);
	const { raw: mergedRaw, seam: joinOffset } = joinRaw(target, curr, presentationMode, linkRef);
	const merged = mergedLeafFor(target, trimTrailingLineEnding(mergedRaw) + lineEnding, grammar);
	if (!merged) return null;

	// The merge writes the deep leaf's raw plus every spine ancestor's rebuilt raw, so
	// unshare the whole spine and resolve through the owned copies.
	if (sharing) ensureUnsharedPath(parent, leafPath, sharing);
	// Write-then-re-read (tree-operations/unshare.ts header), down to the leaf's own slot
	// so a kind change can mint into it.
	installMergedLeaf(holderChildrenAt(parent.children, leafPath), slot, merged, sharing);
	if (mergeTarget.path.length > 0) {
		rebuildAncestryRaw(parent.children[blockIndex - 1], mergeTarget.path);
	}

	const change = deleteNode(parent, blockIndex, sharing);
	return { targetPath: mergeTarget.path, joinOffset, change };
}

/** The children array holding `path`'s last slot, walked from `children`. */
function holderChildrenAt(children: CstNode[], path: number[]): CstNode[] {
	let holder = children;
	for (const index of path.slice(0, -1)) holder = holder[index].children!;
	return holder;
}

/** What the deep-leaf sink will install: the legal bytes, plus their reparse where the kind has
 *  one. The blocks ride whole rather than as their first, so the install answers G1.35. */
interface MergedLeaf {
	written: string;
	blocks: readonly CstNode[];
}

/**
 * The deep-leaf merge's verdict: the absorbed bytes cross the kind's own rule and a fragment
 * reparse. Null when they read as several blocks, since the leaf is one slot (G1.35).
 */
function mergedLeafFor(
	target: CstNode,
	raw: string,
	grammar: GrammarView | undefined
): MergedLeaf | null {
	const written = normalizeOwnRaw(target, raw);
	// A context-dependent kind has no standalone recognizer, so its bytes are never read back
	// as blocks and the write keeps the kind.
	if (tryGetBlockKindDescriptor(target.kind)?.contextDependentKind) {
		return { written, blocks: [] };
	}
	const blocks = parse(written, { grammar, scope: 'fragment' }).children;
	return blocks.length > 1 ? null : { written, blocks };
}

/** {@link mergedLeafFor}'s write, over the unshared spine the verdict was taken ahead of. */
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
		// Byte-honest over the fragment peel, the single-slot sink's rule.
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
 * Merge the node at `blockIndex` with its successor; combined raw is re-parsed and the
 * merged block inherits the current block's ID. Noop at the tail.
 */
export function mergeWithNext(
	parent: NodeParent,
	blockIndex: number,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): MergeResult {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) {
		return { change: { op: 'noop' }, joinOffset: 0 };
	}

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	const { raw: mergedRaw, seam } = joinRaw(curr, next, presentationMode, linkRef);
	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia);
	if (!mergedNode) return { change: { op: 'noop' }, joinOffset: 0 };
	const installed = [mergedNode];
	assertSingleNodeSink('mergeWithNext', installed);
	parent.children.splice(blockIndex, 2, ...installed);
	return { change: replacePreservingFirst(blockIndex, 2, 1), joinOffset: seam };
}

// ── Reparse helper (private) ──

/**
 * Reparse a half's bytes as the blocks they hold, plus the trailing blank line the fragment
 * parse peels into `doc.suffix`: every sink answers for it, or the bytes are lost.
 */
function reparseAsNodes(raw: string, leadingTrivia: string): { nodes: CstNode[]; suffix: string } {
	const doc = parse(raw, { scope: 'fragment' });
	if (doc.children.length === 0) {
		return { nodes: [{ kind: 'paragraph', leadingTrivia, raw }], suffix: doc.suffix };
	}
	doc.children[0].leadingTrivia = leadingTrivia;
	for (const node of doc.children) ensureEditableContainers(node);
	return { nodes: doc.children, suffix: doc.suffix };
}

/**
 * The merge sinks' single-block twin, and their decline: a join whose bytes read as several
 * blocks has no home in one slot, so null refuses it rather than truncating (G1.35).
 */
function reparseAsNode(raw: string, leadingTrivia: string): CstNode | null {
	const { nodes, suffix } = reparseAsNodes(raw, leadingTrivia);
	if (nodes.length > 1) return null;
	// A single-block sink has no follower slot, so the peeled line stays in the block's bytes.
	nodes[0].raw += suffix;
	return nodes[0];
}
