/**
 * Kind-agnostic CST node mutations: path resolution, split, merge, delete, update.
 * Children-array contract: an op mutating a container's top-level children takes the array
 * as a parameter and mutates that, never `node.children` — the caller owns and republishes
 * it, so a direct splice is overwritten. A descendant found by walking the live tree is the
 * exception: mutate it in place on a caller-unshared spine (`unshare.ts`), and route a
 * STRUCTURAL one through its own container's scope via `commitMultiScope`.
 */

import { DEV } from 'esm-env';
import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { isBlankParagraph, isBlankSource, parse } from '../core/parser';
import { isBlockOpenerRegistered, type GrammarView } from '../schema/block-openers';
import { getLiveSplitRebalancer } from '../schema/inline-construct-policy';
import type { PresentationMode } from '../presentation-mode';
import { displayLength, trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
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
import { resyncChildIds } from './children';
import { replacePreservingFirst, type StructuralChange } from './structural-change';

// ── Types ──

/** A children array an op mutates structurally — splice, delete, reorder. */
export type NodeParent = { children: CstNode[] };

/**
 * A {@link NodeParent} that has answered which container owns it. The sinks that WRITE
 * BYTES need that answer: the bytes must satisfy the owner's `bodyWrite` grammar.
 * Nullable rather than optional so every byte-writing site must answer — `undefined` is a
 * real answer (the document root), but skipping the question is a compile error.
 */
export type BodyParent = NodeParent & { ownerKind: AnyBlockKind | undefined };

/**
 * What the byte sinks accept. A whole `Document` is admitted because it IS the answer
 * (the root owns no body grammar); a bare `{ children }` literal still cannot compile.
 */
export type BodyParentArg = BodyParent | Document;

/**
 * What the separator settles accept: anything that can answer where the body starts, whether
 * it holds the owner's kind directly (the container node, the Document) or the sink's answer
 * to it ({@link BodyParentArg}, which this absorbs). Wider than the byte sinks because a
 * settle writes a line ending, not body text — no `bodyWrite` grammar governs it.
 */
export type SeparatorParent = {
	kind?: string;
	ownerKind?: AnyBlockKind;
	innerPrefix?: string;
	children?: CstNode[];
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
 * the two (pinned by `lint/leaf-raw-write-rule`). A rewrite can move parse-derived metadata (an
 * escalated fence length), which an in-place sink has no reparse to re-derive, so this door does it.
 */
export function writeOwnRaw(node: CstNode, raw: string, grammar: GrammarView | undefined): void {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	const legal = descriptor?.normalizeRawWrite?.(raw, node) ?? raw;
	node.raw = legal;
	// A context-dependent kind's raw does not reparse to itself, so its metadata was never
	// parse-derived and a fragment parse would only mis-read it.
	if (legal === raw || descriptor?.contextDependentKind) return;
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

/**
 * Split the node at `blockIndex` at raw `offset` (display-relative). The first half
 * inherits the original ID and the whole structural suffix (a setext underline), which a
 * plain cut would strand below as junk. The second half opens with a blank separator
 * wherever one does structural work ({@link separatorSplitsOffNextLine}) — without it GFM
 * lazy continuation folds the halves back into one block on reload. `presentationMode` is
 * nullable rather than optional: a caller with no mode is a real answer, skipping it is not.
 */
export function splitNode(
	parent: BodyParentArg,
	blockIndex: number,
	offset: number,
	presentationMode: PresentationMode | undefined
): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length) return { op: 'noop' };

	const node = parent.children[blockIndex];
	const descriptor = getBlockKindDescriptor(node.kind);

	// A context-dependent kind (tableCell, container chrome) has no standalone recognizer,
	// so the reparse would destroy both halves; the Enter gesture routes to
	// chrome.descendToBody instead.
	if (descriptor.contextDependentKind) return { op: 'noop' };

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
		const rebalanced = getLiveSplitRebalancer()?.(node, offset, firstRaw, secondRaw);
		if (rebalanced) {
			firstRaw = rebalanced.firstRaw;
			secondRaw = rebalanced.secondRaw;
		}
	}

	const separator = splitSeparator(
		firstRaw,
		secondRaw,
		lineEnding,
		parent.children[blockIndex + 1]
	);
	const firstNodes = reparseAsNodes(firstRaw, node.leadingTrivia);
	const secondNodes = reparseAsNodes(secondRaw, separator);
	if (DEV && firstNodes.length > 1) {
		// The caret lands on `blockIndex + 1` after every split gesture, and a list-item Enter
		// takes everything past it as the new item — both read the second half by that index.
		devWarn('tree-ops', `splitNode: the first half parsed to ${firstNodes.length} blocks`);
	}

	parent.children.splice(blockIndex, 1, ...firstNodes, ...secondNodes);
	return replacePreservingFirst(blockIndex, 1, firstNodes.length + secondNodes.length);
}

/**
 * The cut a split makes, given the caret's `offset`: an ending the offset lands ON terminates
 * the FIRST half rather than opening the second, which would mint a blank line nobody typed
 * (GH #95). A CRLF is one boundary, so a cut between its bytes moves past both. Clamped to a
 * content range's end, past which the offset stops being a content position at all.
 */
function cutPastLineEnding(descriptor: BlockKindDescriptor, node: CstNode, offset: number): number {
	const raw = node.raw;
	const ending = raw[offset] === '\n' ? '\n' : raw.startsWith('\r\n', offset) ? '\r\n' : '';
	if (ending === '') return offset;
	const contentEnd = descriptor.getContentRange?.(node).end;
	return contentEnd === undefined
		? offset + ending.length
		: Math.min(offset + ending.length, contentEnd);
}

/**
 * The stand-in for whatever the user types into the second half: the maximally-continuable
 * line, so the predicate answers for the worst case rather than one construct. Openers are
 * arbitrary code, so no line is unclaimable by construction — {@link probeLineOpensAsProse}
 * is the runtime check, pinned by `split-separator.test.ts`.
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

/** True when `node` is absent or a blank block — the two ways a blank run is open above. */
function opensBlankRunAbove(node: CstNode | undefined): boolean {
	return node === undefined || isBlankParagraph(node);
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
	return separatorSplitsOffNextLine(firstRaw, lineEnding) ? lineEnding : '';
}

function blankHalfBecomesBlock(firstRaw: string, secondRaw: string, lineEnding: string): boolean {
	return (
		parse(firstRaw + lineEnding + secondRaw, { scope: 'fragment' }).children.length >
		parse(firstRaw + secondRaw, { scope: 'fragment' }).children.length
	);
}

/**
 * Would a blank line between `raw` and the line after it split off a second block? Asking
 * that directly, rather than whether the tight join merges, is what keeps the predicate
 * free of a kind list: a construct whose body swallows both forms alike answers no on its
 * own, so the separator never lands inside a body. Blank blocks are discounted on both
 * sides — the separator materializes as one, and counting it would answer yes for every raw.
 */
function separatorSplitsOffNextLine(raw: string, lineEnding: string): boolean {
	if (DEV && !probeLineOpensAsProse()) {
		devWarn(
			'tree-ops',
			`a registered opener claims ${JSON.stringify(NEXT_PROSE_LINE)}, so the split-separator probe no longer stands in for prose`
		);
	}
	const probe = NEXT_PROSE_LINE + lineEnding;
	return contentBlockCount(raw + lineEnding + probe) > contentBlockCount(raw + probe);
}

function contentBlockCount(source: string): number {
	return parse(source, { scope: 'fragment' }).children.filter((node) => !isBlankParagraph(node))
		.length;
}

/**
 * A split that keeps a kind's structural suffix — raw beyond its content range, today
 * only the setext underline — on the first half. Null when the kind has no suffix, or the
 * offset is at block start or inside the suffix itself; both keep the plain raw cut.
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
	return {
		// The retained suffix opens with the ending of the line it follows, so a cut sitting
		// just past one would double it into a blank line and strand the suffix below (GH #95).
		firstRaw: trimTrailingLineEnding(raw.slice(0, offset)) + raw.slice(contentEnd),
		secondRaw: raw.slice(offset, contentEnd)
	};
}

// ── Merge ──

/**
 * Merge the node at `blockIndex` into its predecessor; combined raw is re-parsed and the
 * merged block inherits prev's ID. Noop at index 0.
 */
export function mergeWithPrevious(parent: NodeParent, blockIndex: number): StructuralChange {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return { op: 'noop' };

	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	const mergedRaw = trimTrailingLineEnding(prev.raw) + curr.raw;
	// A merge of two blank blocks collapses the run, so prev's separator no longer describes
	// where the survivor sits; re-derive it.
	const trivia = isBlankSource(mergedRaw)
		? blankBlockTrivia(
				opensBlankRunAbove(parent.children[blockIndex - 2]),
				parent.children[blockIndex + 1],
				trailingLineEnding(prev.raw)
			)
		: prev.leadingTrivia;
	const mergedNode = reparseAsNode(mergedRaw, trivia);
	// curr's own separator dies with it, so the successor inherits it unless it has one —
	// the same rule `deleteNode` applies, and for the same reason.
	const successor = parent.children[blockIndex + 1];
	if (successor) successor.leadingTrivia = successor.leadingTrivia || curr.leadingTrivia;
	parent.children.splice(blockIndex - 1, 2, mergedNode);
	return replacePreservingFirst(blockIndex - 1, 2, 1);
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
	parent: NodeParent,
	blockIndex: number,
	sharing?: SharingState
): MergeIntoPrevResult | null {
	if (blockIndex <= 0 || blockIndex >= parent.children.length) return null;

	const mergeTarget = findMergeTarget(parent.children[blockIndex - 1]);
	if (!mergeTarget) return null;

	// The merge writes the deep leaf's raw plus every spine ancestor's rebuilt raw, so
	// unshare the whole spine and resolve through the owned copies.
	let target = mergeTarget.target;
	if (sharing) {
		const chain = ensureUnsharedPath(parent, [blockIndex - 1, ...mergeTarget.path], sharing);
		target = chain[chain.length - 1];
	}
	const prev = parent.children[blockIndex - 1];
	const curr = parent.children[blockIndex];

	const targetRaw = target.raw ?? '';
	const currRaw = curr.raw ?? '';
	const lineEnding = trailingLineEnding(targetRaw);
	const targetText = trimTrailingLineEnding(targetRaw);
	const currText = trimTrailingLineEnding(currRaw);
	const joinOffset = targetText.length;

	target.raw = targetText + currText + lineEnding;
	if (mergeTarget.path.length > 0) {
		rebuildAncestryRaw(prev, mergeTarget.path);
	}

	const change = deleteNode(parent, blockIndex, sharing);
	return { targetPath: mergeTarget.path, joinOffset, change };
}

/**
 * Merge the node at `blockIndex` with its successor; combined raw is re-parsed and the
 * merged block inherits the current block's ID. Noop at the tail.
 */
export function mergeWithNext(parent: NodeParent, blockIndex: number): StructuralChange {
	if (blockIndex < 0 || blockIndex >= parent.children.length - 1) return { op: 'noop' };

	const curr = parent.children[blockIndex];
	const next = parent.children[blockIndex + 1];

	const mergedRaw = trimTrailingLineEnding(curr.raw) + next.raw;
	const mergedNode = reparseAsNode(mergedRaw, curr.leadingTrivia);
	parent.children.splice(blockIndex, 2, mergedNode);
	return replacePreservingFirst(blockIndex, 2, 1);
}

// ── Separators ──

/**
 * Settle the separator at `index`: nothing above it needs one at the body head or below a blank
 * block, where the parser would read the extra line as one more empty paragraph. Every splice
 * that changes what precedes a block settles it. `sharing` owns the write (G1.9).
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
 * the other way round, because its mint arm has only one legal slot.
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
export function restoreSeparatorAfterBlank(
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
 * carries exactly the one separating line its reload mints — across every block in it AND its
 * follower, since a blank block is the follower's line too. Two reload as one more empty
 * paragraph; none folds the run's head into the block above. The first line that already stands
 * is the one kept, wherever in the run it sits; a mint lands at the run's head, the only slot a
 * new one may take (a later block sits under a blank predecessor, which needs no separator).
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
	// A run with no LINE above it (the document head, a plain container's body head) separates
	// from nothing and materializes in full; a chrome or opener line above it is still a line.
	const wanted = start > 0 || opensAfterALine(parent) ? 1 : 0;
	if (standing.length < wanted) return mintSeparator(parent, start, sharing);
	for (const at of standing.slice(wanted)) {
		const owned = sharing ? ensureUnsharedChild(parent as NodeParent, at, sharing) : children[at];
		owned.leadingTrivia = '';
	}
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

/** A body parsed after its container's opener LINE has one above its head (the `innerPrefix` peel). */
function opensAfterALine(parent: SeparatorParent): boolean {
	const kind = ownerKindNameOf(parent);
	if (kind === undefined) return false;
	return !!tryGetBlockKindDescriptor(kind as AnyBlockKind)?.bodyWrap?.afterOpenerLine;
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
	if (parent.kind === undefined || (parent.innerPrefix ?? '') !== '') return;
	if (!tryGetBlockKindDescriptor(parent.kind as AnyBlockKind)?.bodyWrap?.afterOpenerLine) return;
	const head = parent.children?.[bodyStart];
	if (!head || head.leadingTrivia !== '') return;
	if (index !== bodyStart && !isBlankParagraph(head)) return;
	parent.innerPrefix = trailingLineEnding(freed);
}

// ── Delete ──

/**
 * Remove the node at `blockIndex`, leaving the next sibling separated from its new
 * predecessor and no more. Pass `sharing` to unshare the nodes written — the successor's
 * trivia is the op's only in-place write.
 */
export function deleteNode(
	parent: NodeParent,
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
	return { op: 'delete', at: blockIndex, count: 1 };
}

// ── Update Content ──

/**
 * Update raw and re-parse. The sole re-parse transfer funnel: a kind change mints the
 * reparsed block into the slot rather than reassigning `kind` in place, and multi-block
 * text mints every parsed block. Only a same-kind single-block edit writes fields in
 * place, so routine typing keeps the node's object identity; `replacePreservingFirst`
 * carries the id/ref across a mint. `sharing` owns the separator settle's writes, which land
 * on the run's OTHER blocks — bytes the caller's own unshare never covered.
 */
export function updateNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar?: GrammarView,
	sharing?: SharingState
): StructuralChange {
	const wasBlank = isBlankParagraph(parent.children[blockIndex]);
	const change = writeParsedContent(parent, blockIndex, text, grammar);
	// One blank line served BOTH sides: it separated this block from the one above
	// (`splitSeparator` leaves a blank half none of its own when a run is already open below)
	// and stood in as the separator of the block beneath it. Ending it owes each their own.
	if (wasBlank && !isBlankParagraph(parent.children[blockIndex])) {
		restoreSeparatorOnFill(parent, blockIndex, sharing);
		restoreSeparatorAfterBlank(parent, followerIndexAfter(change, blockIndex), sharing);
		return change;
	}
	// The reverse transition: the block IS the separating line now, so the run it joins gives
	// back the second one (GH #96). The last block minted is the one that meets the follower.
	if (!wasBlank) settleSeparatorOnBlank(parent, lastMintedIndex(change, blockIndex), sharing);
	return change;
}

/** Where the filled block's follower ended up: a multi-block reparse pushes it down. */
function followerIndexAfter(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount : blockIndex + 1;
}

/** The last block the write left in the slot: a multi-block reparse mints past the first. */
function lastMintedIndex(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount - 1 : blockIndex;
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
	const newText = forBody(parent, text);

	// A context-dependent kind (tableCell, plugin chrome) has no standalone recognizer, so
	// reparsing would downgrade it: keep the kind and write raw through the kind's own
	// legality pass, since a delimiter arriving bare would restructure the container.
	if (oldDescriptor.contextDependentKind) {
		writeOwnRaw(node, newText, grammar);
		return { op: 'noop' };
	}

	// The instance grammar reaches the routine content-commit reparse; absent (paste,
	// split/merge reparse) defaults to the global grammar. Fragment scope: this is one
	// block's bytes, whatever its position, so a position-scoped kind must not mint here.
	const parsed = parse(newText, { grammar, scope: 'fragment' }).children;
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
 * What the grammar opens `line` as, read in isolation. The opener-significance test
 * {@link reclassifyContainer}'s callers gate on, asked of the opener registry rather than
 * a hand-written prefix rule, so a kind registered later is covered the day it registers.
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

// ── Reparse helper (private) ──

/**
 * Reparse a half's bytes as the blocks they hold. Plural because a half stands in a position
 * its bytes never occupied, where a construct boundary can newly materialize — an html closer
 * below the prose it used to sit inside. Keeping only the first block would drop the rest of
 * the document's bytes with it (GH #95).
 */
function reparseAsNodes(raw: string, leadingTrivia: string): CstNode[] {
	const doc = parse(raw, { scope: 'fragment' });
	if (doc.children.length === 0) return [{ kind: 'paragraph', leadingTrivia, raw }];
	doc.children[0].leadingTrivia = leadingTrivia;
	for (const node of doc.children) ensureEditableContainers(node);
	return doc.children;
}

/** The merge sinks' single-block twin: concatenated raw joins two lines, so it stays one block. */
function reparseAsNode(raw: string, leadingTrivia: string): CstNode {
	const nodes = reparseAsNodes(raw, leadingTrivia);
	if (DEV && nodes.length > 1) {
		devWarn(
			'tree-ops',
			`reparseAsNode: raw parsed to ${nodes.length} blocks; all but the first are dropped`
		);
	}
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
				// Runtime chrome kind — generic-mint cast (the paragraph below is a literal arm).
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
