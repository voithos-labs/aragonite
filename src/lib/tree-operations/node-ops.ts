/**
 * Kind-agnostic CST node mutations: path resolution, split, merge, delete, update. Children-array
 * contract: an op mutating a container's top-level children takes the array as a parameter and
 * mutates that, never `node.children` — the caller owns and republishes it, so a direct splice is
 * overwritten. A descendant found by walking the live tree is the exception: mutate it in place on
 * a caller-unshared spine (`unshare.ts`), a STRUCTURAL one via `commitMultiScope`.
 */

import { DEV } from 'esm-env';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { isBlankParagraph, isBlankSource, parse, type ContainerBodyWrap } from '../core/parser';
import { escalatedFenceLength, matchFenceOpen } from '../core/parsers/fence-syntax';
import { isBlockOpenerRegistered, type GrammarView } from '../schema/block-openers';
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
	trailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import { devWarn } from '../dev-warn';
import { assignChildIdsDeep } from '../block-id';
import { perfEnabled, recordContainerKindReparse } from '../perf/instruments';
import { findMergeTarget } from '../schema/merge-rules';
import { rebuildAncestryRaw } from '../schema/container-raw';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor
} from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';
import type { SharingState } from './sharing';
import { ensureUnsharedChild, ensureUnsharedPath } from './unshare';
import { resyncChildIds, spliceChildren } from './children';
import {
	applyStructuralChangeToIdsRefs,
	replacePreservingFirst,
	type StructuralChange
} from './structural-change';
import { assertInvariant } from '../invariants/assert';
import { checkSingleNodeSink } from '../invariants/single-node-sink';
import { checkSplitLanding } from '../invariants/split-landing';
import { checkStructuralDescriptor } from '../invariants/structural-descriptor';

// ── Types ──

/** A children array an op mutates structurally — splice, delete, reorder. */
export type NodeParent = { children: CstNode[] };

/**
 * A {@link NodeParent} that has answered which container owns it — the byte sinks need that
 * answer for the owner's `bodyWrite` grammar and its wrap slots. Both nullable rather than
 * optional so every byte-writing site answers: `undefined` is a real answer (the document
 * root), skipping the question is a compile error.
 */
export type BodyParent = NodeParent & {
	ownerKind: AnyBlockKind | undefined;
	owner: CstNode | undefined;
	/**
	 * The document root's foldable trailing line, when these children are its.
	 * Optional, not nullable: only a ceremony-backed site may carry it, because the settle
	 * that consumes it appends a block — the out-of-ceremony write paths stay slotless so a
	 * structural materialization is unrepresentable there.
	 */
	suffix?: string;
};

/**
 * What the byte sinks accept. A whole `Document` is admitted because it IS the answer
 * (the root owns no body grammar); a bare `{ children }` literal still cannot compile.
 */
export type BodyParentArg = BodyParent | Document;

/**
 * What the separator settles accept: anything that can answer where the body starts, whether
 * it holds the owner's kind directly (the container node, the Document) or the sink's answer
 * to it ({@link BodyParentArg}, which this absorbs). Wider than the byte sinks: a settle
 * writes a line ending, not body text.
 */
export type SeparatorParent = {
	kind?: string;
	ownerKind?: AnyBlockKind;
	innerPrefix?: string;
	innerSuffix?: string;
	suffix?: string;
	children?: CstNode[];
	owner?: CstNode;
};

const ownerKindOf = (parent: BodyParentArg): AnyBlockKind | undefined =>
	'ownerKind' in parent ? parent.ownerKind : undefined;

/**
 * Text made legal as a child's raw inside a container of kind `ownerKind`. Exported for
 * sinks that build their own bytes rather than handing text to {@link updateNodeContent}.
 */
export function normalizeBodyWrite(ownerKind: AnyBlockKind | undefined, raw: string): string {
	const owner = ownerKind === undefined ? undefined : tryGetBlockKindDescriptor(ownerKind);
	return owner?.bodyWrite?.normalize(raw) ?? raw;
}

const forBody = (parent: BodyParentArg, raw: string): string =>
	normalizeBodyWrite(ownerKindOf(parent), raw);

/**
 * `raw` made legal as `node`'s OWN bytes — {@link normalizeBodyWrite}'s node-side twin, for the
 * kind's own grammar rather than its container's. Sinks that REPLACE the node with a reparse of
 * the result call this door: the reparse re-derives metadata from the bytes, so structure the
 * rule restores from the old metadata (a fence closer a truncation consumed) must land first.
 */
export function normalizeOwnRaw(node: NodeView, raw: string): string {
	return tryGetBlockKindDescriptor(node.kind)?.normalizeRawWrite?.(raw, node) ?? raw;
}

/**
 * Write `raw` as `node`'s OWN bytes through its kind's rule — {@link normalizeOwnRaw}'s in-place
 * sink. Every sink writing a leaf's bytes without the kind's surface in front of it owes one of
 * the two (pinned by `lint/leaf-raw-write-rule`).
 */
export function writeOwnRaw(node: CstNode, raw: string, grammar: GrammarView | undefined): void {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const legal = descriptor?.normalizeRawWrite?.(raw, node) ?? raw;
	node.raw = legal;
	// A context-dependent kind's raw does not reparse to itself, so its metadata was never
	// parse-derived and a fragment parse would only mis-read it.
	if (descriptor?.contextDependentKind) return;
	// In place means no reparse replaces the node, so parse-owned metadata re-derives here —
	// for the rule's own rewrite AND bytes the caller's edit already changed.
	const reparsed = parse(legal, { grammar, scope: 'fragment' }).children;
	if (reparsed.length === 1 && reparsed[0].kind === node.kind) node.metadata = reparsed[0].metadata;
}

// ── Node minting ──

/**
 * The paragraph mint. Every argument is required: a paragraph's raw ENDS in a line ending,
 * so a mint site must answer which document it lands in (G4.20) rather than strand a lone
 * LF in a CRLF file. Returns a fresh node every call — a shared instance would alias across
 * tree positions and corrupt the snapshot/unshare model (G1.9).
 */
export function paragraphNode(leadingTrivia: string, text: string, lineEnding: string): CstNode {
	return { kind: 'paragraph', leadingTrivia, raw: text + lineEnding };
}

/** The empty-paragraph placeholder keeping an emptied document or container caret-addressable. */
export function emptyParagraph(leadingTrivia: string, lineEnding: string): CstNode {
	return paragraphNode(leadingTrivia, '', lineEnding);
}

// ── Path resolution ──

// Overloaded rather than view-only so a mutable document yields mutable nodes:
// a walk cannot introduce sharing, so the input's writability is the output's.
export function nodeAt(doc: Document, path: number[]): CstNode | Document | null;
export function nodeAt(doc: DocumentView, path: number[]): NodeView | DocumentView | null;
export function nodeAt(doc: DocumentView, path: number[]): NodeView | DocumentView | null {
	let cur: NodeView | DocumentView = doc;
	for (const idx of path) {
		if (!cur.children || idx < 0 || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}

/** `nodeAt` pre-narrowed through `isBlockNode`: null at the document root or on no match. */
export function blockNodeAt(doc: Document, path: number[]): CstNode | null;
export function blockNodeAt(doc: DocumentView, path: number[]): NodeView | null;
export function blockNodeAt(doc: DocumentView, path: number[]): NodeView | null {
	const node = nodeAt(doc, path);
	return node !== null && isBlockNode(node) ? node : null;
}

/**
 * Narrow a `nodeAt` result to `CstNode`. Structural, not kind-based: a plugin may mint
 * `'document'` as a block kind, so only the absence of `raw` discriminates.
 */
export function isBlockNode(node: CstNode | Document): node is CstNode;
export function isBlockNode(node: NodeView | DocumentView): node is NodeView;
export function isBlockNode(node: NodeView | DocumentView): boolean {
	return 'raw' in node;
}

// ── Split ──

/** What a split leaves the caret: the structural splice, plus where the second half's head
 *  landed — past `blockIndex + 1` when the first half reparsed to several blocks. */
export interface SplitResult {
	change: StructuralChange;
	secondHalfIndex: number;
}

/**
 * The landing a site is about to consume, held to the primitive's answer (G1.34). The
 * top-level path seats the caret at it and the list path splices at it, so both cross this
 * on their way to using it; a re-derived `blockIndex + 1` warns instead of shipping.
 */
export function assertSplitLanding(split: SplitResult, landing: number): void {
	assertInvariant('split-landing', () => checkSplitLanding(split.secondHalfIndex, landing));
}

/**
 * What a one-slot sink is about to put in its slot, held to one node (G1.35). Asked at the WRITE
 * with the nodes being written, so the guard answers for sink N+1 — one that skips the refusal its
 * siblings make, or splices a plural replacement into a slot that holds one.
 */
export function assertSingleNodeSink(sink: string, installed: readonly CstNode[]): void {
	assertInvariant('single-node-sink', () => checkSingleNodeSink(sink, installed.length));
}

/**
 * Split the node at `blockIndex` at raw `offset` (display-relative). The first half inherits the
 * original ID and the whole structural suffix (a setext underline), which a plain cut would strand
 * below as junk. The second half opens with a blank separator wherever one does structural work
 * ({@link separatorSplitsOffNextLine}) — without it GFM lazy continuation folds the halves back
 * into one block on reload.
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
	// Both halves: each can collide alone — a `</details>` stranded on the second half, or
	// a first half promoted to a bare terminator once its trailing text is cut away.
	let firstRaw = forBody(parent, suffixSplit ? suffixSplit.firstRaw : rawText.slice(0, cut));
	let secondRaw = forBody(parent, suffixSplit ? suffixSplit.secondRaw : rawText.slice(cut));

	if (!firstRaw.endsWith('\n')) {
		firstRaw += lineEnding;
	}

	if (!secondRaw.endsWith('\n')) {
		secondRaw += lineEnding;
	}

	// Live alone rebalances: there the delimiters around the cut are unpainted, so a byte-literal
	// half would surface runs the reader never saw. The rebalancer verifies its own bytes and
	// declines when they do not parse back, leaving the literal cut every other mode gets.
	if (presentationMode === 'live') {
		const rebalanced = getLiveSplitRebalancer()?.(node, offset, firstRaw, secondRaw, linkRef);
		if (rebalanced) {
			firstRaw = rebalanced.firstRaw;
			secondRaw = rebalanced.secondRaw;
			// The rewrite verifies its halves STANDALONE, where a missing final ending is
			// legal; at the seam the halves would share a line and rejoin on reload.
			if (!firstRaw.endsWith('\n')) firstRaw += lineEnding;
			if (!secondRaw.endsWith('\n')) secondRaw += lineEnding;
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
		// Legal — the landing index rides the result — but rare enough to keep visible.
		devWarn('tree-ops', `splitNode: the first half parsed to ${first.nodes.length} blocks`);
	}

	const nodes = [...first.nodes, ...second.nodes];
	// The second half's peeled line has no follower inside the splice, so it stays in raw.
	nodes[nodes.length - 1].raw += second.suffix;
	const splitTail = blockIndex === parent.children.length - 1;
	parent.children.splice(blockIndex, 1, ...nodes);
	// Floor at the seam itself: a wider window would reach back into the spliced set and
	// break the one-window accounting below. At the tail there is no successor to re-read, and
	// the document's folded line is the settle funnel's question, not this sink's.
	const seamLeft = blockIndex + nodes.length - 1;
	const eaten = splitTail ? 0 : absorbSeamReading(parent, seamLeft, seamLeft, sharing).eaten;
	return {
		change: replacePreservingFirst(blockIndex, 1 + eaten, nodes.length),
		secondHalfIndex: blockIndex + first.nodes.length
	};
}

/**
 * The cut a split makes, given the caret's `offset`: an ending the offset lands ON terminates
 * the FIRST half rather than opening the second, which would mint a blank line nobody typed.
 * A CRLF is one boundary, so a cut between its bytes moves past both. Clamped to a content
 * range's end, past which the offset stops being a content position at all.
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
 * The stand-in for whatever the user types into the second half: the maximally-continuable
 * line, so the predicate answers for the worst case rather than one construct. Openers are
 * arbitrary code, so no line is unclaimable by construction — {@link probeLineOpensAsProse}
 * is the runtime check.
 */
export const NEXT_PROSE_LINE = 'x';

/** Whether the ambient grammar still leaves {@link NEXT_PROSE_LINE} an ordinary paragraph. */
export function probeLineOpensAsProse(grammar?: GrammarView): boolean {
	return lineOpensAs(NEXT_PROSE_LINE, grammar) === 'paragraph';
}

/**
 * Leading trivia for a freshly minted BLANK block. A blank line is a block only past its
 * run's first line, so it separates from a non-blank predecessor — unless a run is already
 * open below, where the successor's own separator opens it.
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
 * The second half's leading trivia. A blank half follows {@link blankBlockTrivia}; a prose
 * half takes a separator exactly when lazy continuation would fold the halves back together.
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
 * bytes, never a kind list: a construct whose body swallows both forms alike answers no on its
 * own, so the separator never lands inside a body. Blank blocks are discounted on both sides —
 * the separator materializes as one, and counting it would answer yes for every raw.
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
 * A split that keeps a kind's structural suffix — raw beyond its content range, the setext
 * underline — on the first half. Null when the kind has no suffix, or the offset is at block
 * start or inside the suffix itself; both keep the plain raw cut.
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
 * `join.mergedRaw` with the delimiter runs the join orphaned at its seam dropped — live only,
 * where those runs are unpainted and a literal concatenation surfaces bytes the reader never saw
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
 * where the two sides now meet (a cleanup that drops a run on the first side moves it).
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
 *  survivor's bytes — which a seam cleanup moves when it drops a run on the first block's side. */
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
 * reparsing concatenated raw — preserves prev's component identity, IME state, and the
 * leaves' inline caches. Pass `sharing` to unshare everything the merge writes. Null when
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

/** What the deep-leaf sink will install: the legal bytes, plus their reparse where the kind
 *  has one — a different kind mints into the slot, the same kind refreshes it in place. The
 *  blocks ride whole rather than as their first, so the install answers G1.35 over what it writes. */
interface MergedLeaf {
	written: string;
	blocks: readonly CstNode[];
}

/**
 * The deep-leaf merge's verdict: the absorbed bytes cross the kind's own rule and a fragment
 * reparse. Null when they read as several blocks — the leaf is one slot, and writing them
 * whole leaves a tree its own reload disagrees with (G1.35).
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
	target.metadata = parsed.metadata;
	target.children = parsed.children;
	resyncChildIds(target);
	// The reparsed children are fresh nodes, so their own containers carry no `childIds`.
	assignChildIdsDeep(target);
	target.innerPrefix = parsed.innerPrefix;
	target.innerSuffix = parsed.innerSuffix;
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

// ── Separators ──

/**
 * Settle the separator at `index`: nothing above it needs one at the body head or below a blank
 * block, where the parser would read the extra line as one more empty paragraph. Every splice
 * that changes what precedes a block settles through this family (syntax-tree.md § Blank lines).
 * `sharing` owns the write (G1.9).
 */
export function clearRedundantSeparator(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	const node = parent.children?.[index];
	if (!node || node.leadingTrivia === '') return;
	const bodyStart = bodyStartIndex(parent);
	if (index < bodyStart) return;
	const predecessor = index > bodyStart ? parent.children![index - 1] : undefined;
	if (predecessor !== undefined && !isBlankParagraph(predecessor)) return;
	const owned = sharing ? ensureUnsharedChild(parent as NodeParent, index, sharing) : node;
	const freed = owned.leadingTrivia;
	owned.leadingTrivia = '';
	absorbWrapPrefix(parent, bodyStart, index, freed);
}

/**
 * A blank block IS a blank line, so it and its follower share ONE separator: two of them reload
 * as a second empty paragraph (G2.13). The follower's is the one that stands, so a later fill of
 * this slot (a paste over a cut range) still finds the follower separated. The run-level twin
 * {@link settleSeparatorOnBlank} keeps the first already-standing line instead, the same bytes
 * the other way round.
 */
export function dropDoubledSeparator(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	const node = parent.children?.[index];
	if (!node || node.leadingTrivia === '' || !isBlankParagraph(node)) return;
	if ((parent.children?.[index + 1]?.leadingTrivia ?? '') === '') return;
	const owned = sharing ? ensureUnsharedChild(parent as NodeParent, index, sharing) : node;
	owned.leadingTrivia = '';
}

/**
 * The separator a block takes back when it stops being blank: its own blank line was what stood
 * between it and a non-blank predecessor. Call at the fill — {@link clearRedundantSeparator}
 * frees a separator in exactly the cases this declines, and a block that was never blank keeps
 * whatever its bytes earned (a paragraph under a heading needs none).
 */
export function restoreSeparatorOnFill(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	const node = parent.children?.[index];
	if (!node || node.leadingTrivia !== '' || isBlankParagraph(node)) return;
	mintSeparator(parent, index, sharing);
}

/**
 * The separator the block BELOW a consumed blank line takes back — the same mint minus the
 * blank-self guard, since a blank follower needs the line as much as a prose one. It takes one
 * only where its own follower holds none: two would reload as a second empty paragraph
 * ({@link dropDoubledSeparator}'s rule, declined here rather than undone after).
 */
function restoreSeparatorAfterBlank(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	const children = parent.children;
	const node = children?.[index];
	if (!children || !node || node.leadingTrivia !== '') return;
	if (isBlankParagraph(node) && (children[index + 1]?.leadingTrivia ?? '') !== '') return;
	mintSeparator(parent, index, sharing);
}

/**
 * The settle a block turning INTO a blank line owes: it joins the blank run around it, and a run
 * carries exactly ONE separating line — across every block in it AND its follower, since a blank
 * block is the follower's line too. The line already standing is the one kept, wherever in the
 * run it sits; a mint lands at the run's head, the only slot one may take.
 */
export function settleSeparatorOnBlank(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	const children = parent.children;
	const node = children?.[index];
	if (!children || !node || !isBlankParagraph(node)) return;
	const bodyStart = bodyStartIndex(parent);
	let start = index;
	while (start > bodyStart && isBlankParagraph(children[start - 1])) start--;
	let end = index;
	while (end + 1 < children.length && isBlankParagraph(children[end + 1])) end++;
	const standing: number[] = [];
	for (let i = start; i <= Math.min(end + 1, children.length - 1); i++) {
		if (children[i].leadingTrivia !== '') standing.push(i);
	}
	// A chrome line bounding the run beside PROSE eats one line as the wrap's peel
	// (`innerPrefix`/`innerSuffix`), on top of the run's own count; an all-blank body owes none.
	const wrap = bodyWrapOf(parent);
	const slots = wrapSlotsOf(parent);
	const bodyEnd = children.length - 1;
	// A run of two or more that IS the whole body sits against both chrome lines, and the reload
	// peels one line into each slot before it materializes a block — so it owes BOTH, where an
	// arm bounded by prose on one side grants at most one.
	const twoPeelBody =
		!!slots &&
		wrap?.afterOpenerLine === true &&
		wrap.beforeCloserLine === true &&
		start === bodyStart &&
		end === bodyEnd &&
		start < end;
	const tailBelowProse = start > bodyStart && end === bodyEnd;
	if (slots && wrap?.beforeCloserLine && (tailBelowProse || twoPeelBody) && !slots.innerSuffix) {
		slots.innerSuffix = trailingLineEnding(children[end].raw);
	}
	// The reverse: a deletion can leave a lone blank as the WHOLE body, where the closer
	// peel no longer engages beside the opener's — the run gives the extra line back.
	const loneBlankBody = start === bodyStart && end === bodyEnd && start === end;
	if (slots && loneBlankBody && slots.innerSuffix && (slots.innerPrefix || standing.length > 0)) {
		slots.innerSuffix = '';
	}
	const headUnderWrap =
		!!slots && wrap?.afterOpenerLine === true && start === bodyStart && end < bodyEnd;
	// A line already standing IS the opener's peel on reload, so taking one as well would add a
	// line — but a two-peel body's count comes out of the slots, not out of the run.
	const takesOpenerPeel = twoPeelBody || (headUnderWrap && standing.length === 0);
	if (slots && takesOpenerPeel && !slots.innerPrefix) {
		slots.innerPrefix = trailingLineEnding(children[start].raw);
	}
	// Under the wrap the run keeps exactly the one peel line — in `innerPrefix` or still
	// standing; elsewhere a run with no LINE above it (the document head, a plain container's
	// body head) separates from nothing and materializes in full.
	const wanted = twoPeelBody
		? 0
		: headUnderWrap
			? slots?.innerPrefix
				? 0
				: 1
			: start > 0 || wrap?.afterOpenerLine
				? 1
				: 0;
	if (standing.length < wanted) {
		mintSeparator(parent, start, sharing);
	} else {
		for (const at of standing.slice(wanted)) {
			const owned = sharing ? ensureUnsharedChild(parent as NodeParent, at, sharing) : children[at];
			owned.leadingTrivia = '';
		}
	}
	materializeTailSuffix(parent, sharing);
}

/**
 * The give-back twin of {@link settleSeparatorOnBlank}'s closer peel: a blank run reaching the
 * body tail borrows a line into `innerSuffix` so the reload keeps the block, and a tail that
 * stops being blank owes it back or the wrap emits a line nobody typed. A trailing blank the
 * author wrote against the closer reaches the same shape and is spent here too — one cosmetic
 * line, against a stray one after every tail split.
 */
function releaseWrapPeel(parent: SeparatorParent, index: number): void {
	const children = parent.children;
	const slots = wrapSlotsOf(parent);
	if (!children || children.length === 0 || !slots?.innerSuffix) return;
	if (!bodyWrapOf(parent)?.beforeCloserLine) return;
	if (index < children.length - 1) return;
	if (isBlankParagraph(children[children.length - 1])) return;
	slots.innerSuffix = '';
}

/**
 * The parse folds the document's one trailing blank line into `suffix` only while the tail
 * block is non-blank (`parseBlocks`' separator-spent rule); once the tail turns blank the
 * reload reads that line as its own empty paragraph, so the settle materializes it.
 * Document-level slot only — a container's `innerSuffix` twin stays with the wrap arms.
 * Returns the blocks appended.
 */
function materializeTailSuffix(parent: SeparatorParent, sharing?: SharingState): number {
	const children = parent.children;
	const suffix = parent.suffix;
	if (!children || !suffix) return 0;
	// An emptied parent has no tail for the line to fold against, so it is the document's whole
	// content and the reload reads it as the one block there is.
	if (children.length > 0 && !isBlankParagraph(children[children.length - 1])) return 0;
	const minted: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: suffix };
	if (sharing) sharing.stamp(minted);
	children.push(minted);
	parent.suffix = '';
	return 1;
}

// ── The splice settle funnel ──

/**
 * The settle every splice owes its neighbourhood: the vacated separating line hands down, a
 * now-redundant one frees, the two debts a consumed blank line leaves are paid (syntax-tree.md
 * § Blank lines), the folded tail line materializes, and the window's joins are asked. `removed`
 * is the pre-splice span, the only place was-blank survives a splice. `tracked` rides the folds
 * for a door landing a caret in the spliced bytes. Returns `change` widened by everything the
 * settle itself did.
 */
function settleSplicedWindow(
	parent: SeparatorParent,
	at: number,
	removed: readonly CstNode[],
	added: number,
	change: StructuralChange,
	sharing?: SharingState,
	tracked?: TrackedPosition
): StructuralChange {
	if (!parent.children) return change;
	// Ahead of the arms: `settleSeparatorOnBlank` materializes the tail line itself, so a count
	// read after it would leave that growth outside the window the sink reports.
	const beforeMint = parent.children.length;
	handDownVacatedSeparator(parent, at, removed[0]?.leadingTrivia ?? '', sharing);
	clearRedundantSeparator(parent, at, sharing);
	if (removed.some(isBlankParagraph)) {
		// Both ends: the line was the slot's own AND the one below it stood on.
		restoreSeparatorAfterBlank(parent, at, sharing);
		if (added > 0) restoreSeparatorAfterBlank(parent, at + added, sharing);
		releaseWrapPeel(parent, at + Math.max(added - 1, 0));
	} else {
		settleSeparatorOnBlank(parent, at + Math.max(added - 1, 0), sharing);
	}
	// Unconditional, and the funnel's only home for it: every arm above probes a slot inside the
	// window, and a delete window at the tail has none — the question is about the parent's LAST
	// block, which no window position answers.
	materializeTailSuffix(parent, sharing);
	const widened = widenForTailMint(change, beforeMint, parent.children.length);
	// The seam question is part of SETTLING, not a rule each door carries: paste, replace, delete
	// and fill all splice through here, so door N+1 inherits it. A byte-shaped write
	// reporting `noop` splices no window and is asked nothing.
	return absorbWindowSeams(
		parent as NodeParent,
		at,
		added,
		at,
		widened,
		sharing,
		tracked,
		// A one-slot window names the one block whose bytes changed, which is what lets the seam
		// above decline on its first line; a plural one names no single block.
		added === 1 ? at : undefined
	).change;
}

/** Whoever takes the slot inherits its line, having none of its own — {@link deleteNode}'s rule. */
function handDownVacatedSeparator(
	parent: SeparatorParent,
	at: number,
	vacated: string,
	sharing?: SharingState
): void {
	const heir = parent.children?.[at];
	if (vacated === '' || !heir || heir.leadingTrivia !== '') return;
	const owned = sharing ? ensureUnsharedChild(parent as NodeParent, at, sharing) : heir;
	owned.leadingTrivia = vacated;
}

/**
 * The commit ceremony's settle door: derive the spliced window from the change and settle it
 * against `before`, the pre-mutate children the ceremony still holds. Nodes surviving inside the
 * window are not removals, so a coarse descriptor over an in-place write settles as one.
 * `tracked` is the committing door's caret, carried through the folds. Returns the change widened
 * by a tail line the settle materialized.
 */
export function settleSeparator(
	parent: SeparatorParent,
	before: readonly CstNode[],
	change: StructuralChange,
	sharing?: SharingState,
	tracked?: TrackedPosition
): StructuralChange {
	const window = splicedWindow(change);
	const children = parent.children;
	if (!window || !children) return change;
	// At the funnel's door, ahead of every arm: a window the mutate mis-derived reads `before`
	// out of bounds and hands the arms a negative span, which each would clamp into silence.
	assertInvariant('structural-descriptor', () => checkStructuralDescriptor(change, before.length));
	const survivors = new Set(children.slice(window.at, window.at + window.added));
	const removed = before
		.slice(window.at, window.at + window.removed)
		.filter((node) => !survivors.has(node));
	return settleSplicedWindow(parent, window.at, removed, window.added, change, sharing, tracked);
}

function splicedWindow(
	change: StructuralChange
): { at: number; removed: number; added: number } | null {
	switch (change.op) {
		case 'noop':
			return null;
		case 'insert':
			return { at: change.at, removed: 0, added: change.count };
		case 'delete':
			return { at: change.at, removed: change.count, added: 0 };
		case 'replace':
			return { at: change.at, removed: change.count, added: change.newCount };
	}
}

/**
 * The out-of-commit-scope twin of {@link settleSeparator}, for a container discovered by walking
 * the live tree: it splices through the `childIds` door and reads the pre-splice span itself.
 */
export function spliceChildrenSettled(
	parent: CstNode | Document,
	at: number,
	removeCount: number,
	replacement: CstNode[],
	sharing?: SharingState
): void {
	const children = parent.children;
	if (!children || at < 0 || at > children.length) return;
	const removed = children.slice(at, at + removeCount);
	spliceChildren(parent as CstNode, at, removeCount, ...replacement);
	// `noop` in, so what comes back describes the SETTLE alone: `spliceChildren` already carried
	// the door's own splice into `childIds`, and out of commit scope nothing else publishes.
	const settled = settleSplicedWindow(
		parent as SeparatorParent,
		at,
		removed,
		replacement.length,
		{ op: 'noop' },
		sharing
	);
	const ids = (parent as CstNode).childIds;
	if (ids) applyStructuralChangeToIdsRefs(settled, ids, new Array(ids.length));
}

/**
 * What a seam settle absorbed: post-splice window position and size, and the net blocks eaten
 * (negative when a materialized peel outgrew the window). `span + eaten` is the pre-absorb slot
 * count, which is what a change descriptor reports; `spliced` says the window moved at all.
 */
interface SeamAbsorption {
	at: number;
	span: number;
	eaten: number;
	spliced: boolean;
}

/**
 * A byte position the folds carry with them: the slot it lives in, and its offset inside that
 * slot's raw. Written in place, since each fold re-tiles the bytes under it.
 */
export interface TrackedPosition {
	index: number;
	offset: number;
}

/**
 * A splice can leave neighbours whose adjacent bytes re-read as fewer blocks on reload — a list
 * standing above indented code absorbs it, and no separator can hold indentation apart.
 * Absorb while the window's own bytes parse to fewer blocks, which is the reload's reading;
 * byte-identical by construction. A blank run is transparent to a container's continuation, so the
 * window anchors at the nearest non-blank block above the seam, never below `floor`, and cascades.
 */
function absorbSeamReading(
	parent: NodeParent,
	seamLeft: number,
	floor: number,
	sharing?: SharingState,
	tracked?: TrackedPosition,
	headProbe?: number
): SeamAbsorption {
	const children = parent.children;
	if (seamLeft < 0) return { at: 0, span: 0, eaten: 0, spliced: false };
	let left = seamLeft;
	while (left > floor && isBlankParagraph(children[left])) left--;
	const at = left;
	let span = seamLeft - at + 1;
	let eaten = 0;
	let spliced = false;
	// Only the first pass: a fold re-tiles the window, so the probe's absolute index is stale.
	let probe = headProbe;
	for (;;) {
		// The candidate edge crosses a blank run too: the absorbed content sits on the
		// run's far side (a list continues into indented code across any number of blanks).
		let right = at + span;
		while (right < children.length && isBlankParagraph(children[right])) right++;
		const window = children.slice(at, Math.min(right + 1, children.length));
		if (window.length <= span || window.length < 2) break;
		// A context-dependent kind has no standalone reading, so its seam is not askable.
		if (window.some((node) => tryGetBlockKindDescriptor(node.kind)?.contextDependentKind)) break;
		if (probe !== undefined && declinesOnHeadLine(window, probe - at)) break;
		probe = undefined;
		let joined = window[0].raw;
		for (let i = 1; i < window.length; i++) joined += window[i].leadingTrivia + window[i].raw;
		const reparsed = parse(joined, { scope: 'fragment' });
		const blocks = reparsed.children;
		if (blocks.length === 0 || blocks.length >= window.length) break;
		// A legitimate fold EXTENDS the window's head block, so its kind survives its own
		// reparse. A structured container's children fail this by construction — two items'
		// joined bytes read as a nested LIST — and the seam is not askable there.
		if (blocks[0].kind !== window[0].kind) break;
		absorbFragmentPeel(parent, at + window.length, reparsed.suffix, blocks, sharing);
		blocks[0].leadingTrivia = window[0].leadingTrivia;
		for (const block of blocks) {
			ensureEditableContainers(block);
			if (sharing) sharing.stamp(block);
			assignChildIdsDeep(block);
		}
		if (tracked) retrackThroughFold(tracked, at, window, blocks);
		children.splice(at, window.length, ...blocks);
		eaten += window.length - blocks.length;
		span = blocks.length;
		spliced = true;
	}
	return { at, span, eaten, spliced };
}

/**
 * Decline-only pre-parse for a window whose LAST member is the block that changed: join the
 * others with only that block's first line. Block parsing is a left-to-right line scan, so the
 * state entering that line is the same in both strings — if it opens a block here it opens one
 * in the full join and no fold is possible. A pass falls through to the real parse, so no fold
 * verdict is ever taken from truncated bytes. Costs the window minus the changed block, which is
 * what keeps a keystroke inside a giant container off its own bytes.
 */
function declinesOnHeadLine(window: readonly CstNode[], member: number): boolean {
	if (member <= 0 || member !== window.length - 1) return false;
	let joined = window[0].raw;
	for (let i = 1; i < member; i++) joined += window[i].leadingTrivia + window[i].raw;
	const raw = window[member].raw;
	const nl = raw.indexOf('\n');
	joined += window[member].leadingTrivia + (nl < 0 ? raw : raw.slice(0, nl + 1));
	return parse(joined, { scope: 'fragment' }).children.length >= window.length;
}

/**
 * Where a byte position inside the folded window lands: the fold's own reparse re-tiles the
 * joined bytes, and a position past the window only shifts by what the fold ate.
 */
function retrackThroughFold(
	tracked: TrackedPosition,
	at: number,
	window: readonly CstNode[],
	blocks: readonly CstNode[]
): void {
	const member = tracked.index - at;
	if (member < 0) return;
	if (member >= window.length) {
		tracked.index -= window.length - blocks.length;
		return;
	}
	// The window joins as `window[0].raw` then each follower's trivia and raw.
	let joined = tracked.offset;
	for (let i = 0; i < member; i++) {
		joined += (i === 0 ? 0 : window[i].leadingTrivia.length) + window[i].raw.length;
	}
	if (member > 0) joined += window[member].leadingTrivia.length;
	const landed = focusTargetInReplacement(blocks, joined);
	tracked.index = at + landed.index;
	tracked.offset = landed.offset;
}

/** What a splice settled: its change widened by every fold, and where a tracked index landed. */
export interface SettledSplice {
	change: StructuralChange;
	landing: number;
}

/**
 * The seam question at every join the splice at `at` disturbed — its window's two edges and the
 * joins inside it — since a move can invalidate a join that was already correct. Each
 * fold cascades downward, so the next seam is asked past what that one ate. `tracked` rides the
 * folds for a caller placing a caret in bytes an absorb can move. `headProbe` names the one block
 * whose bytes changed, letting each ask decline on its first line alone; dropped once anything
 * folds, since the index it names has moved by then.
 */
export function absorbWindowSeams(
	parent: NodeParent,
	at: number,
	added: number,
	landing: number,
	change: StructuralChange,
	sharing?: SharingState,
	tracked?: TrackedPosition,
	headProbe?: number
): SettledSplice {
	let settled: SeamAbsorption | null = null;
	let moved = landing;
	let seamLeft = at - 1;
	let last = at + added - 1;
	while (seamLeft <= last) {
		const seam = absorbSeamReading(
			parent,
			seamLeft,
			0,
			sharing,
			tracked,
			settled ? undefined : headProbe
		);
		if (!seam.spliced) {
			seamLeft++;
			continue;
		}
		settled = settled ? unionAbsorptions(settled, seam) : seam;
		moved = indexAfterAbsorb(moved, seam);
		last = indexAfterAbsorb(last, seam);
		seamLeft = seam.at + seam.span;
	}
	if (!settled) return { change, landing: moved };
	return { change: foldAbsorbIntoChange(change, settled), landing: moved };
}

/** Two folds as ONE window, which is what a change descriptor reports. The walk is left to
 *  right, so `later` never opens above `earlier`'s post-splice span. */
function unionAbsorptions(earlier: SeamAbsorption, later: SeamAbsorption): SeamAbsorption {
	return {
		at: earlier.at,
		span: later.at + later.span - earlier.at,
		eaten: earlier.eaten + later.eaten,
		spliced: true
	};
}

/** Where `index` sits once `seam` folded: a slot inside the absorbed span collapses into it. */
function indexAfterAbsorb(index: number, seam: SeamAbsorption): number {
	if (index < seam.at) return index;
	const absorbedTo = seam.at + seam.span + seam.eaten;
	return index >= absorbedTo ? index - seam.eaten : Math.min(index, seam.at + seam.span - 1);
}

/**
 * Where the fragment parse's peeled trailing blank run goes. At the parent's tail it stays in the
 * last block's raw, the single-slot sink's rule; mid-document it joins the follower's run, where
 * one line separates and every later one is a block of its own (syntax-tree.md § Blank lines).
 */
function absorbFragmentPeel(
	parent: NodeParent,
	followerIndex: number,
	peel: string,
	blocks: CstNode[],
	sharing?: SharingState
): void {
	const follower = parent.children[followerIndex];
	if (!follower) {
		blocks[blocks.length - 1].raw += peel;
		return;
	}
	if (peel === '') return;
	const lines = blankLinesOf(peel + follower.leadingTrivia);
	const owned = sharing ? ensureUnsharedChild(parent, followerIndex, sharing) : follower;
	owned.leadingTrivia = lines.length > 1 ? '' : lines[0];
	for (let i = 1; i < lines.length; i++) {
		blocks.push({ kind: 'paragraph', leadingTrivia: i === 1 ? lines[0] : '', raw: lines[i] });
	}
}

/** A blank run split back into the lines it is made of, each keeping its own ending. */
const blankLinesOf = (run: string): string[] => run.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** The materialized tail reported inside the sink's one contiguous window. */
export function widenForTailMint(
	change: StructuralChange,
	before: number,
	after: number
): StructuralChange {
	const grown = after - before;
	if (grown === 0) return change;
	if (change.op === 'noop') return { op: 'insert', at: before, count: grown };
	if (change.op === 'insert' && change.at + change.count === before) {
		return { ...change, count: change.count + grown };
	}
	if (change.op === 'replace' && change.at + change.newCount === before) {
		return { ...change, newCount: change.newCount + grown };
	}
	// A delete that took the tail vacated the slot the mint lands in, so the two are one window.
	if (change.op === 'delete' && change.at === before) {
		return { op: 'replace', at: change.at, count: change.count, newCount: grown };
	}
	// The mint landed past a window that does not reach the tail, so no single contiguous
	// span describes both; the parallel arrays would drift either way this widened it.
	devWarn('tree-ops', 'a tail suffix materialized outside the reported window');
	return change;
}

/** A blank line off the node's own bytes (G4.20), where one does structural work at all. */
function mintSeparator(parent: SeparatorParent, index: number, sharing?: SharingState): void {
	const children = parent.children;
	if (!children || index <= bodyStartIndex(parent)) return;
	if (isBlankParagraph(children[index - 1])) return;
	const owned = sharing
		? ensureUnsharedChild(parent as NodeParent, index, sharing)
		: children[index];
	owned.leadingTrivia = trailingLineEnding(owned.raw);
}

/** Reserved chrome is not a body block, so the body window opens past it. */
function bodyStartIndex(parent: SeparatorParent): number {
	return bodyStartFor(ownerKindNameOf(parent));
}

/** The container's declared body wrap, whichever shape names the owner. */
function bodyWrapOf(parent: SeparatorParent): ContainerBodyWrap | undefined {
	const kind = ownerKindNameOf(parent);
	if (kind === undefined) return undefined;
	return tryGetBlockKindDescriptor(kind as AnyBlockKind)?.bodyWrap;
}

/** The node carrying the wrap's peel slots: the sink's answer, or the parent when it IS the node. */
function wrapSlotsOf(parent: SeparatorParent): CstNode | undefined {
	return parent.owner ?? ('raw' in parent ? (parent as CstNode) : undefined);
}

/** The kind whose body these children are: the sink's answer, or the owner node's own. */
function ownerKindNameOf(parent: SeparatorParent): string | undefined {
	return 'ownerKind' in parent ? parent.ownerKind : parent.kind;
}

function bodyStartFor(kind: string | undefined): number {
	if (kind === undefined) return 0;
	return tryGetBlockKindDescriptor(kind as AnyBlockKind)?.reservedChrome ? 1 : 0;
}

/**
 * A chrome-wrapped container's parse peels the blank line against its opener into `innerPrefix`
 * (`core/parser.parseContainerBody`), so a separator freed above the body head is that line
 * rather than dead bytes: hand it over, or the peel eats the head block instead.
 */
function absorbWrapPrefix(
	parent: SeparatorParent,
	bodyStart: number,
	index: number,
	freed: string
): void {
	const slots = wrapSlotsOf(parent);
	if (!slots || (slots.innerPrefix ?? '') !== '') return;
	if (!bodyWrapOf(parent)?.afterOpenerLine) return;
	const head = parent.children?.[bodyStart];
	if (!head || head.leadingTrivia !== '') return;
	if (index !== bodyStart && !isBlankParagraph(head)) return;
	slots.innerPrefix = trailingLineEnding(freed);
}

// ── Delete ──

/**
 * Remove the node at `blockIndex`, leaving the next sibling separated from its new predecessor
 * and no more. Takes {@link BodyParentArg} because the settle can hand a freed line to the
 * owner's wrap slots. Pass `sharing` to unshare the nodes written — the successor's trivia is
 * the op's only in-place write.
 */
export function deleteNode(
	parent: BodyParentArg,
	blockIndex: number,
	sharing?: SharingState
): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return { op: 'noop' };

	const deleted = parent.children[blockIndex];

	if (blockIndex + 1 < parent.children.length) {
		const successor = sharing
			? ensureUnsharedChild(parent, blockIndex + 1, sharing)
			: parent.children[blockIndex + 1];
		// The successor inherits the deleted separator only when it has none of its own:
		// concatenating both leaves behind a blank line the delete should have taken.
		successor.leadingTrivia = successor.leadingTrivia || deleted.leadingTrivia;
	}

	parent.children.splice(blockIndex, 1);
	clearRedundantSeparator(parent, blockIndex, sharing);
	// BOTH the survivor's edges: the delete puts it beside a new follower, and a merge door that
	// rewrote its bytes can equally have stopped it interrupting the block above.
	const survivor = Math.max(blockIndex - 1, 0);
	return absorbWindowSeams(
		parent,
		survivor,
		blockIndex - survivor,
		blockIndex,
		{ op: 'delete', at: blockIndex, count: 1 },
		sharing
	).change;
}

// ── Update Content ──

/** What a content write settled: its change widened by every fold, and the offset the written
 *  text starts at inside that change's window — nonzero once a fold above absorbed it. */
export interface SettledContent {
	change: StructuralChange;
	textStart: number;
}

/**
 * Update raw and re-parse. The sole re-parse transfer funnel: a kind change mints the reparsed
 * block into the slot rather than reassigning `kind` in place, and multi-block text mints every
 * parsed block. Only a same-kind single-block edit writes fields in place, so routine typing keeps
 * the node's object identity; `replacePreservingFirst` carries the id/ref across a mint. `sharing`
 * owns the separator settle's writes, which land on the run's OTHER blocks.
 */
export function updateNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar?: GrammarView,
	sharing?: SharingState
): SettledContent {
	const wasBlank = isBlankParagraph(parent.children[blockIndex]);
	const change = writeParsedContent(parent, blockIndex, text, grammar);
	const lastWritten = lastMintedIndex(change, blockIndex);
	// One blank line served BOTH sides: it separated this block from the one above and stood in
	// as the separator of the block beneath it. Ending it owes each their own.
	if (wasBlank && !isBlankParagraph(parent.children[blockIndex])) {
		restoreSeparatorOnFill(parent, blockIndex, sharing);
		restoreSeparatorAfterBlank(parent, followerIndexAfter(change, blockIndex), sharing);
		releaseWrapPeel(parent, lastWritten);
		return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing);
	}
	// The reverse transition: the block IS the separating line now, so the run it joins gives
	// back the second one. The last block minted is the one that meets the follower.
	if (!wasBlank && isBlankParagraph(parent.children[lastWritten])) {
		const settled = parent.children.length;
		settleSeparatorOnBlank(parent, lastWritten, sharing);
		const widened = widenForTailMint(change, settled, parent.children.length);
		return settleWriteSeams(parent, blockIndex, lastWritten, widened, sharing);
	}
	// Both blank transitions settle above whatever their change op says; this guard is for
	// same-kind typing INSIDE content, which must never pay a neighbour reparse.
	if (change.op === 'noop') return { change, textStart: 0 };
	return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing);
}

/**
 * Ask every join the write disturbed, both edges of its window included, and report where the
 * written text ended up: an absorb ABOVE leaves the predecessor standing, so its bytes and the
 * join newline now sit in front of the text the caret was typed into.
 */
function settleWriteSeams(
	parent: BodyParentArg,
	blockIndex: number,
	lastWritten: number,
	change: StructuralChange,
	sharing?: SharingState
): SettledContent {
	const tracked: TrackedPosition = { index: blockIndex, offset: 0 };
	const settled = absorbWindowSeams(
		parent,
		blockIndex,
		lastWritten - blockIndex + 1,
		blockIndex,
		change,
		sharing,
		tracked
	);
	return {
		change: settled.change,
		textStart: textOffsetInWindow(parent.children, settled.change, tracked)
	};
}

/**
 * The tracked position as an offset in the settled window's committed text — the space every
 * caret door measures in ({@link focusTargetInReplacement}), where the head block's own
 * leading trivia is outside the window.
 */
function textOffsetInWindow(
	children: readonly CstNode[],
	change: StructuralChange,
	tracked: TrackedPosition
): number {
	const at = change.op === 'noop' ? tracked.index : change.at;
	let pos = 0;
	for (let i = at; i < tracked.index; i++) {
		pos += (i === at ? 0 : children[i].leadingTrivia.length) + children[i].raw.length;
	}
	const ownTrivia = tracked.index > at ? children[tracked.index].leadingTrivia.length : 0;
	return pos + ownTrivia + tracked.offset;
}

/**
 * The absorbed window folded into the write's own, as the ONE contiguous window the sink
 * reports: `count` counts pre-write slots, so the union's span converts back across whatever
 * the write itself added or removed.
 */
function foldAbsorbIntoChange(change: StructuralChange, seam: SeamAbsorption): StructuralChange {
	const absorbedTo = seam.at + seam.span + seam.eaten;
	if (change.op === 'noop') {
		return {
			op: 'replace',
			at: seam.at,
			count: absorbedTo - seam.at,
			newCount: seam.span,
			idMap: { 0: 0 }
		};
	}
	const written =
		change.op === 'insert' ? change.count : change.op === 'delete' ? 0 : change.newCount;
	const removed = change.op === 'insert' ? 0 : change.count;
	const lo = Math.min(seam.at, change.at);
	const hi = Math.max(absorbedTo, change.at + written);
	const count = hi - lo - written + removed;
	const newCount = hi - lo - seam.eaten;
	return {
		op: 'replace',
		at: lo,
		count,
		newCount,
		idMap: composeFoldIdMap(change, seam, { lo, count, newCount, written, removed })
	};
}

/** The union window's extents, in the two index spaces the composition steps through. */
interface FoldWindow {
	lo: number;
	count: number;
	newCount: number;
	written: number;
	removed: number;
}

/**
 * Identity through the fold: a slot the absorb did not re-mint still holds the block the change
 * put there, so its id composes through both steps instead of resetting. Slot 0 keeps the head
 * mapping wherever the walk has none — the fold's head block survives its own reparse (`kind`
 * equality is what admits the fold), which is the identity `replacePreservingFirst` reports.
 */
function composeFoldIdMap(
	change: StructuralChange,
	seam: SeamAbsorption,
	window: FoldWindow
): Record<number, number> {
	const idMap: Record<number, number> = {};
	for (let slot = 0; slot < window.newCount; slot++) {
		const index = window.lo + slot;
		if (index >= seam.at && index < seam.at + seam.span) continue;
		// Back through the fold: a slot past the absorbed span sat `eaten` further down before it.
		const spliced = index < seam.at ? index : index + seam.eaten;
		const old = preChangeIndex(change, spliced, window);
		if (old === null) continue;
		const oldSlot = old - window.lo;
		if (oldSlot >= 0 && oldSlot < window.count) idMap[slot] = oldSlot;
	}
	if (idMap[0] === undefined) idMap[0] = 0;
	return idMap;
}

/** Where `spliced` (a post-change index) stood before the change, or null for a slot it minted. */
function preChangeIndex(
	change: StructuralChange,
	spliced: number,
	window: FoldWindow
): number | null {
	if (change.op === 'noop') return spliced;
	if (spliced < change.at) return spliced;
	if (spliced >= change.at + window.written) return spliced - window.written + window.removed;
	const inherited = change.op === 'replace' ? change.idMap?.[spliced - change.at] : undefined;
	return inherited === undefined ? null : change.at + inherited;
}

/** Where the filled block's follower ended up: a multi-block reparse pushes it down. */
function followerIndexAfter(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount : blockIndex + 1;
}

/** The last block the write left in the slot: a multi-block reparse mints past the first. */
function lastMintedIndex(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount - 1 : blockIndex;
}

/**
 * The written bytes parsed, with the construct they leave OPEN closed off first. An unterminated
 * construct reads every block below it as its body at the next parse, and the seam settle
 * converges the live tree to exactly that reading. Declines where nothing is at stake: a
 * kind-stable single block never reaches the settle, and a construct with no follower eats
 * nothing.
 */
function closeWrittenConstruct(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	oldKind: AnyBlockKind,
	grammar: GrammarView | undefined
): { text: string; parsed: Document } {
	// An absent grammar defaults to the global one. Fragment scope: this is one block's
	// bytes, whatever its position, so a position-scoped kind must not mint here.
	const parsed = parse(text, { grammar, scope: 'fragment' });
	if (blockIndex + 1 >= parent.children.length) return { text, parsed };
	if (parsed.children.length === 1 && parsed.children[0].kind === oldKind) return { text, parsed };
	const terminator = openConstructTerminator(text, parsed.children, grammar);
	if (!terminator) return { text, parsed };
	const closed = text + terminator;
	return { text: closed, parsed: parse(closed, { grammar, scope: 'fragment' }) };
}

/**
 * The terminator written bytes owe when their last construct absorbs to EOF, asked of the grammar
 * rather than a kind list: swallowing a blank line AND a prose line is what separates an absorber
 * from a paragraph continuing onto the next line. Null when the bytes terminate themselves, or
 * when no fence opener explains the absorb — the one family whose closer its opener determines.
 */
function openConstructTerminator(
	text: string,
	blocks: readonly CstNode[],
	grammar: GrammarView | undefined
): string | null {
	// The terminator is a line of its own, so bytes whose last line is still open have none to
	// append to — G4.20's unterminated tail slice, which absorbs nothing while it stands alone.
	if (!text.endsWith('\n') || blocks.length === 0) return null;
	const ending = trailingLineEnding(text);
	const probe = parse(text + ending + NEXT_PROSE_LINE + ending, { grammar, scope: 'fragment' });
	if (probe.children.length !== blocks.length) return null;
	const raw = blocks[blocks.length - 1].raw;
	const nl = raw.indexOf('\n');
	const opener = matchFenceOpen(nl < 0 ? raw : raw.slice(0, nl));
	if (!opener) return null;
	const body = nl < 0 ? '' : raw.slice(nl + 1);
	const run = escalatedFenceLength(body, opener.marker, opener.length);
	return opener.indent + opener.marker.repeat(run) + ending;
}

function writeParsedContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar?: GrammarView
): StructuralChange {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;
	const oldDescriptor = getBlockKindDescriptor(oldKind);
	// Ahead of every reparse below, so a write lands on the kind its committed bytes
	// describe, not the kind the pre-escape text would parse to (`bodyWrite`).
	const bodyText = forBody(parent, text);

	// A context-dependent kind (tableCell, plugin chrome) has no standalone recognizer, so
	// reparsing would downgrade it: keep the kind and write raw through the kind's own
	// legality pass, since a delimiter arriving bare would restructure the container.
	if (oldDescriptor.contextDependentKind) {
		writeOwnRaw(node, bodyText, grammar);
		return { op: 'noop' };
	}

	const { text: newText, parsed: reparsed } = closeWrittenConstruct(
		parent,
		blockIndex,
		bodyText,
		oldKind,
		grammar
	);
	const parsed = reparsed.children;
	const first: CstNode | undefined = parsed[0];
	// A container whose empty body will be backfilled: a marker-consuming container (a
	// GitHub alert) needs its raw rebuilt from that body, or G1.1 stale-raw fires.
	const firstBackfilled = !!first && isEmptyEditableContainer(first);
	if (first) ensureEditableContainers(first);

	// Text-leading blanks fold into the first block's raw (the single-block shape); the
	// rest keep their own trivia.
	if (parsed.length > 1) {
		const rest = parsed.slice(1);
		for (const sibling of rest) ensureEditableContainers(sibling);
		first.raw = first.leadingTrivia + first.raw;
		first.leadingTrivia = node.leadingTrivia;
		if (firstBackfilled) reconcileBackfilledRaw(first);
		// The peeled line has no follower inside the splice, so it stays in raw.
		rest[rest.length - 1].raw += reparsed.suffix;
		parent.children.splice(blockIndex, 1, first, ...rest);
		return replacePreservingFirst(blockIndex, 1, parsed.length);
	}

	const newKind = first?.kind ?? 'paragraph';

	// In-place refresh keeps the node's object identity: component, IME state, and inline
	// cache are all keyed on it.
	if (newKind === oldKind) {
		node.raw = newText;
		node.metadata = first?.metadata;
		node.children = first?.children;
		// The reparse can change the child count while this branch reports `noop`, so
		// nothing downstream resyncs the parallel id array — and a wrong length is permanent.
		resyncChildIds(node);
		// The reparsed children are fresh nodes, so their own containers carry no `childIds`.
		assignChildIdsDeep(node);
		node.innerPrefix = first?.innerPrefix;
		node.innerSuffix = first?.innerSuffix;
		if (firstBackfilled) reconcileBackfilledRaw(node);
		return { op: 'noop' };
	}

	const replacement: CstNode = first ?? { kind: 'paragraph', leadingTrivia: '', raw: newText };
	replacement.raw = newText;
	replacement.leadingTrivia = node.leadingTrivia;
	if (firstBackfilled) reconcileBackfilledRaw(replacement);
	parent.children.splice(blockIndex, 1, replacement);
	return replacePreservingFirst(blockIndex, 1, 1);
}

// ── Container kind re-derivation ──

/**
 * What the grammar opens `line` as, read in isolation — the opener-significance test, asked of
 * the opener registry and never a kind list, so a kind registered later is covered the day it
 * registers.
 */
export function lineOpensAs(line: string, grammar?: GrammarView): AnyBlockKind {
	return parse(`${line}\n`, { grammar, scope: 'fragment' }).children[0]?.kind ?? 'paragraph';
}

/**
 * Re-derive the container at `index` from its own (already rebuilt) raw, replacing it in
 * the slot when that raw now opens as a different kind. The container twin of
 * `updateNodeContent`'s kind-change arm (editor.md § 8), which no leaf reparse can see.
 * Eligibility is the opener registry, not a kind list — registering an opener is exactly
 * the claim that `parse(raw)` reproduces the kind, so re-deriving one without would destroy it.
 */
export function reclassifyContainer(
	parent: NodeParent,
	index: number,
	grammar?: GrammarView
): CstNode | null {
	const node = parent.children[index];
	if (!node) return null;
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (!descriptor?.isContainer || !isBlockOpenerRegistered(node.kind)) return null;

	if (perfEnabled()) recordContainerKindReparse();
	const parsed = parse(node.raw, { grammar, scope: 'fragment' }).children;
	// A container's raw is one block by construction; a multi-block reparse means bytes
	// this seam has no slot for — leave it to the gesture that owns the mutation.
	if (parsed.length !== 1 || parsed[0].kind === node.kind) return null;

	const replacement = parsed[0];
	const backfilled = isEmptyEditableContainer(replacement);
	ensureEditableContainers(replacement);
	// The slot's trivia is authoritative, so restore the bytes before overwriting it or
	// anything the parse split off the front vanishes with it.
	replacement.raw = node.raw;
	replacement.leadingTrivia = node.leadingTrivia;
	if (backfilled) reconcileBackfilledRaw(replacement);
	// A freshly-parsed node carries no childIds and this swap publishes under the slot's
	// reused component instance, so undefined keys would reach the nested keyed `{#each}`.
	assignChildIdsDeep(replacement);
	parent.children[index] = replacement;
	// Write-then-re-read (tree-operations/unshare.ts header).
	return parent.children[index];
}

/**
 * Map a post-edit caret offset (in the committed text) to the parsed block it falls in,
 * as a local display offset. The first block's body starts at 0; an offset inside
 * inter-block trivia lands at the next block's start; past-the-end clamps to the last.
 */
export function focusTargetInReplacement(
	nodes: readonly NodeView[],
	offset: number
): { index: number; offset: number } {
	let pos = 0;
	for (let i = 0; i < nodes.length; i++) {
		const bodyStart = i === 0 ? 0 : pos + nodes[i].leadingTrivia.length;
		const bodyEnd = bodyStart + trimTrailingLineEnding(nodes[i].raw).length;
		if (offset <= bodyEnd) {
			return { index: i, offset: Math.max(0, offset - bodyStart) };
		}
		pos = bodyStart + nodes[i].raw.length;
	}
	const last = nodes.length - 1;
	return { index: last, offset: trimTrailingLineEnding(nodes[last].raw).length };
}

/**
 * Where a caret at `offset` in the written text lands once {@link updateNodeContent}'s folds
 * settled: an absorb ABOVE leaves the predecessor holding the bytes, so the slot the gesture
 * named is gone and the offset carries what that predecessor put in front of it. Every caret
 * door onto the content funnel asks this, so the settle is answered in one place.
 */
export function settledCaretTarget(
	settled: SettledContent,
	at: number,
	offset: number,
	children: readonly NodeView[]
): { index: number; offset: number } {
	const { change, textStart } = settled;
	if (change.op !== 'replace') return { index: at, offset };
	const shifted = offset + textStart;
	if (change.newCount <= 1) return { index: change.at, offset: shifted };
	const blocks = children.slice(change.at, change.at + change.newCount);
	const target = focusTargetInReplacement(blocks, shifted);
	return { index: change.at + target.index, offset: target.offset };
}

// ── Reparse helper (private) ──

/**
 * Reparse a half's bytes as the blocks they hold, plus the trailing blank line the fragment
 * parse peels into `doc.suffix` — every sink answers for it, or the bytes are lost. Plural
 * because a half stands in a position its bytes never occupied, where a construct boundary
 * can newly materialize.
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
 * blocks has no home in one slot, so it is refused rather than truncated (G1.35). Null is the
 * refusal; the door returns noop and its caller falls back to move-focus.
 */
function reparseAsNode(raw: string, leadingTrivia: string): CstNode | null {
	const { nodes, suffix } = reparseAsNodes(raw, leadingTrivia);
	if (nodes.length > 1) return null;
	// A single-block sink has no follower slot, so the peeled line stays in the block's bytes.
	nodes[0].raw += suffix;
	return nodes[0];
}

// ── Replacement normalization ──

/** First node inherits the original block's leadingTrivia; subsequent nodes keep theirs. */
export function normalizeReplacementTrivia(original: CstNode, replacement: CstNode[]): CstNode[] {
	const originalTrivia = original.leadingTrivia ?? '';
	return replacement.map((node, i) => {
		const copy = { ...node };
		copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
		return copy;
	});
}

// ── Editable container backfill ──

/**
 * A container `ensureEditableContainers` will backfill. Read BEFORE the backfill runs —
 * afterwards it holds the synthesized paragraph and no longer qualifies.
 */
function isEmptyEditableContainer(node: CstNode): boolean {
	const d = getBlockKindDescriptor(node.kind);
	return d.isContainer && d.blockFocus !== 'whole-block' && (node.children?.length ?? 0) === 0;
}

/**
 * Sync a just-backfilled container's `raw` to its synthesized body. Needed only for a
 * marker-consuming container whose typed raw lacks a blank body line (`> [!TYPE]`);
 * blockquote/listItem already strip to the blank, so their rebuild is a no-op.
 */
function reconcileBackfilledRaw(node: CstNode): void {
	getBlockKindDescriptor(node.kind).rebuildRaw?.(node);
}

/** Ensure every container has at least one child block, so the cursor always has a target. */
export function ensureEditableContainers(node: CstNode): void {
	// A whole-block-focus kind is childless by design — the block itself is the caret
	// target, and a backfilled paragraph its raw can't account for trips opaque-stale-raw.
	if (getBlockKindDescriptor(node.kind).blockFocus === 'whole-block') return;
	if (node.children !== undefined) {
		if (node.children.length === 0) {
			// discovered-descendant mutation, see file header
			const chromeKind = reservedChromeKindOf(node.kind);
			// Backfilled lines take the container's own ending (G4.20) — they are pure
			// line ending, so a literal LF strands one inside a CRLF container.
			const lineEnding = trailingLineEnding(node.raw);
			// A chrome-declaring container must re-mint its child-0 leaf too, or the
			// backfilled paragraph would occupy the reserved slot and violate G1.14.
			if (chromeKind !== undefined) {
				// Runtime chrome kind, so the mint takes the generic cast.
				node.children.push({ kind: chromeKind, leadingTrivia: '', raw: lineEnding } as CstNode);
			}
			node.children.push(emptyParagraph('', lineEnding));
			// The synthesized paragraph's ending already represents the blank `parseBlocks`
			// routed into innerPrefix; keeping both double-counts the line on rebuild.
			node.innerPrefix = '';
		}
		for (const child of node.children) {
			ensureEditableContainers(child);
		}
	}
}
