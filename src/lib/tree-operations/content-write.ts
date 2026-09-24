/**
 * The content write: every byte that enters a node goes through `updateNodeContent`, the one
 * reparse path (editor.md § 6, § 8), and its container counterpart that re-derives a container's
 * kind from its rebuilt raw.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph, parse } from '../core/parser';
import { escalatedFenceLength, matchFenceOpen } from '../core/parsers/fence-syntax';
import { isBlockOpenerRegistered, type GrammarView } from '../schema/block-openers';
import { trailingLineEnding } from '../core/lines';
import { assignChildIdsDeep } from '../block-id';
import { perfEnabled, recordContainerKindReparse } from '../perf/instruments';
import { getBlockKindDescriptor, tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { resyncChildIds } from './children';
import { spliceMany } from './splice-many';
import { leafAtRawOffset } from './container-offsets';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { reconcileTaskMetadata, taskMarkerMayStandBefore } from './list/reconcile-task';
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';
import {
	NEXT_PROSE_LINE,
	ensureEditableContainers,
	forBody,
	writeOwnRaw,
	type BodyParentArg,
	type NodeParent
} from './node-primitives';
import {
	absorbWindowSeams,
	focusTargetInReplacement,
	releaseWrapPeel,
	restoreSeparatorAfterBlank,
	restoreSeparatorOnFill,
	settleSeparatorOnBlank,
	widenForTailMint,
	type TrackedPosition
} from './settle';

// ── Update Content ──

/** What a content write produced once its neighbours were fixed up: its change widened by every
 *  merge, and the offset the written text starts at inside that change's window (nonzero once a
 *  merge above absorbed it). */
export interface SettledContent {
	change: StructuralChange;
	textStart: number;
}

/**
 * Update raw and reparse. A kind change puts the reparsed block in the position rather than
 * reassigning `kind` in place, and multi-block text creates every parsed block; only a same-kind
 * single-block edit writes in place, so routine typing keeps the node's object identity.
 */
export function updateNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar?: GrammarView,
	sharing?: SharingState
): SettledContent {
	// Read before the write, which is what can put a block there the marker cannot stand before.
	const stood = taskMarkerMayStandBefore(parent.children[blockIndex]);
	const settled = writeAndSettleContent(parent, blockIndex, text, grammar, sharing);
	// A list item's task marker belongs to its first block, so the write that changed that block
	// decides whether it keeps it. Before the container's raw rebuild, which writes the marker.
	const owner = 'owner' in parent ? parent.owner : undefined;
	if (owner) reconcileTaskMetadata(owner, blockIndex, stood, sharing);
	return settled;
}

function writeAndSettleContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar?: GrammarView,
	sharing?: SharingState
): SettledContent {
	const wasBlank = isBlankParagraph(parent.children[blockIndex]);
	const indentMoved = leadingIndent(parent.children[blockIndex].raw) !== leadingIndent(text);
	const change = writeParsedContent(parent, blockIndex, text, grammar);
	const lastWritten = lastMintedIndex(change, blockIndex);
	// One blank line served both sides: it separated this block from the one above and stood in
	// as the separator of the block beneath it. Filling it gives each side its own.
	if (wasBlank && !isBlankParagraph(parent.children[blockIndex])) {
		restoreSeparatorOnFill(parent, blockIndex, sharing);
		restoreSeparatorAfterBlank(parent, followerIndexAfter(change, blockIndex), sharing);
		releaseWrapPeel(parent, lastWritten);
		return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing, grammar);
	}
	// The reverse transition: the block is the separating line now, so the run it joins gives
	// back the second one. The last block created is the one that meets the follower.
	if (!wasBlank && isBlankParagraph(parent.children[lastWritten])) {
		const settled = parent.children.length;
		settleSeparatorOnBlank(parent, lastWritten, sharing);
		const widened = widenForTailMint(change, settled, parent.children.length);
		return settleWriteSeams(parent, blockIndex, lastWritten, widened, sharing, grammar);
	}
	// Same-kind typing inside content must never pay for a neighbour reparse. The exceptions are
	// the writes whose first-line indent is new, and a blank line that stays blank: the indent
	// decides whether a list item above takes the block in (editor.md § 8).
	if (change.op === 'noop' && !wasBlank && !indentMoved) return { change, textStart: 0 };
	return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing, grammar);
}

const leadingIndent = (text: string): string => /^[ \t]*/.exec(text)![0];

/**
 * Ask every join the write disturbed whether it merges, and report where the written text ended
 * up: a merge into the block above leaves that block standing, so its bytes now sit in front of
 * the text.
 */
function settleWriteSeams(
	parent: BodyParentArg,
	blockIndex: number,
	lastWritten: number,
	change: StructuralChange,
	sharing: SharingState | undefined,
	grammar: GrammarView | undefined
): SettledContent {
	const tracked: TrackedPosition = { index: blockIndex, offset: 0 };
	const settled = absorbWindowSeams(
		parent,
		blockIndex,
		lastWritten - blockIndex + 1,
		blockIndex,
		change,
		sharing,
		tracked,
		undefined,
		undefined,
		grammar
	);
	return {
		change: settled.change,
		textStart: textOffsetInWindow(parent.children, settled.change, tracked)
	};
}

/**
 * The tracked position as an offset in the window's committed text, the space every caret
 * placement measures in, where the head block's own leading blank lines are outside the window.
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

/** Where the filled block's follower ended up: a multi-block reparse pushes it down. */
function followerIndexAfter(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount : blockIndex + 1;
}

/** The last block the write left in the position: a multi-block reparse creates blocks past
 *  the first. */
function lastMintedIndex(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount - 1 : blockIndex;
}

/**
 * The written bytes parsed, with any construct they leave open closed off first: an unterminated
 * construct reads every block below it as its body at the next parse, and the neighbour merge
 * would bring the live tree to exactly that reading.
 */
function closeWrittenConstruct(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	oldKind: AnyBlockKind,
	read: FragmentReader
): { text: string; parsed: Document } {
	const parsed = read(text);
	if (blockIndex + 1 >= parent.children.length) return { text, parsed };
	if (parsed.children.length === 1 && parsed.children[0].kind === oldKind) return { text, parsed };
	const terminator = openConstructTerminator(text, parsed.children, read);
	if (!terminator) return { text, parsed };
	const closed = text + terminator;
	return { text: closed, parsed: read(closed) };
}

/**
 * The closing line the written bytes need when their last construct runs to end of file, asked
 * of the grammar rather than a kind list. Null when the bytes close themselves, or when no fence
 * opener explains the run (the one family whose closer its opener determines).
 */
function openConstructTerminator(
	text: string,
	blocks: readonly CstNode[],
	read: FragmentReader
): string | null {
	// The closer is a line of its own, so bytes whose last line is unterminated have nowhere to
	// put one (the unterminated tail slice of G4.20, which absorbs nothing while it stands alone).
	if (!text.endsWith('\n') || blocks.length === 0) return null;
	const ending = trailingLineEnding(text);
	const probe = read(text + ending + NEXT_PROSE_LINE + ending);
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
	// Before every reparse below, so the write lands on the kind its committed bytes describe,
	// not the kind the text would parse to before the container's escape (`bodyWrite`).
	const bodyText = forBody(parent, text);

	// A context-dependent kind has no standalone recognizer, so reparsing would downgrade it:
	// keep the kind and write raw through its own legality pass.
	if (oldDescriptor.contextDependentKind) {
		writeOwnRaw(node, bodyText, grammar);
		return { op: 'noop' };
	}

	const { text: newText, parsed: reparsed } = closeWrittenConstruct(
		parent,
		blockIndex,
		bodyText,
		oldKind,
		fragmentReaderAt('owner' in parent ? parent.owner : undefined, blockIndex, grammar)
	);
	const parsed = reparsed.children;
	const first: CstNode | undefined = parsed[0];
	// A marker-consuming container (a GitHub alert) needs its raw rebuilt from the backfilled
	// body, or raw and children disagree (G1.1).
	const firstBackfilled = !!first && isEmptyEditableContainer(first);
	if (first) ensureEditableContainers(first);

	// Blank lines at the start of the text go into the first block's raw (as in the single-block
	// case); the rest keep their own separators.
	if (parsed.length > 1) {
		const rest = parsed.slice(1);
		for (const sibling of rest) ensureEditableContainers(sibling);
		first.raw = first.leadingTrivia + first.raw;
		first.leadingTrivia = node.leadingTrivia;
		if (firstBackfilled) reconcileBackfilledRaw(first);
		// The trailing blank line the parse split off has no follower inside the splice, so it
		// stays in raw.
		rest[rest.length - 1].raw += reparsed.suffix;
		spliceMany(parent.children, blockIndex, 1, parsed);
		return replacePreservingFirst(blockIndex, 1, parsed.length);
	}

	const newKind = first?.kind ?? 'paragraph';

	// In-place refresh keeps the node's object identity: component, IME state, and inline
	// cache are all keyed on it.
	if (newKind === oldKind) {
		node.raw = newText;
		adoptReparsedFields(node, first);
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

/**
 * Refresh a node in place from its own reparse, keeping its object identity. The id resync is
 * unconditional: the reparse can change the child count while the caller reports `noop`.
 */
export function adoptReparsedFields(target: CstNode, parsed: CstNode | undefined): void {
	target.metadata = parsed?.metadata;
	target.children = parsed?.children;
	resyncChildIds(target);
	assignChildIdsDeep(target);
	target.innerPrefix = parsed?.innerPrefix;
	target.innerSuffix = parsed?.innerSuffix;
}

/** A container `ensureEditableContainers` will backfill; read before the backfill runs. */
function isEmptyEditableContainer(node: CstNode): boolean {
	const d = getBlockKindDescriptor(node.kind);
	return d.isContainer && d.blockFocus !== 'whole-block' && (node.children?.length ?? 0) === 0;
}

/**
 * Sync a just-backfilled container's `raw` to its synthesized body. Needed only for a
 * marker-consuming container whose typed raw lacks a blank body line (`> [!TYPE]`).
 */
function reconcileBackfilledRaw(node: CstNode): void {
	getBlockKindDescriptor(node.kind).rebuildRaw?.(node);
}

// ── Container kind re-derivation ──

/**
 * What the grammar opens `line` as, read in isolation: asked of the opener registry and never
 * a kind list, so a kind registered later is covered the day it registers.
 */
export function lineOpensAs(line: string, grammar?: GrammarView): AnyBlockKind {
	return parse(`${line}\n`, { grammar, scope: 'fragment' }).children[0]?.kind ?? 'paragraph';
}

/** Whether the grammar in effect still leaves `NEXT_PROSE_LINE` an ordinary paragraph. */
export function probeLineOpensAsProse(grammar?: GrammarView): boolean {
	return lineOpensAs(NEXT_PROSE_LINE, grammar) === 'paragraph';
}

/**
 * Re-derive the container at `index` from its own (already rebuilt) raw, replacing it in the
 * slot when that raw now opens as a different kind (editor.md § 8). Eligibility is the opener
 * registry: registering an opener is exactly the claim that `parse(raw)` reproduces the kind.
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
	// A container's raw is one block by construction; a multi-block reparse means bytes this
	// function has no position for, left to the edit that owns the mutation.
	if (parsed.length !== 1 || parsed[0].kind === node.kind) return null;

	const replacement = parsed[0];
	const backfilled = isEmptyEditableContainer(replacement);
	ensureEditableContainers(replacement);
	// The position's own `leadingTrivia` is authoritative, so restore the bytes before
	// overwriting it or anything the parse split off the front vanishes with it.
	replacement.raw = node.raw;
	replacement.leadingTrivia = node.leadingTrivia;
	if (backfilled) reconcileBackfilledRaw(replacement);
	// A freshly parsed node carries no `childIds`, and this swap is written to state under the
	// position's reused component instance, so undefined keys would reach the nested keyed
	// `{#each}`.
	assignChildIdsDeep(replacement);
	parent.children[index] = replacement;
	// Write, then re-read through the tree (`unshare.ts` header).
	return parent.children[index];
}

/** A caret position after a content write: the block at `index`, then `path` down to the leaf
 *  the caret sits in (empty when the block is that leaf), and the offset in that leaf. */
export interface SettledCaret {
	index: number;
	path: number[];
	offset: number;
}

/**
 * Where a caret at `offset` in the written text ends up once {@link updateNodeContent}'s merges
 * are done: a merge into the block above leaves that block holding the bytes, so the position
 * the edit named is gone and the offset includes what that block put in front of it. A block the
 * write made a container is entered, since a raw offset into it names no caret position.
 */
export function settledCaretTarget(
	settled: SettledContent,
	at: number,
	offset: number,
	children: readonly NodeView[]
): SettledCaret {
	const { change, textStart } = settled;
	if (change.op !== 'replace') return caretInBlock(children, at, offset);
	const shifted = offset + textStart;
	if (change.newCount <= 1) return caretInBlock(children, change.at, shifted);
	const blocks = children.slice(change.at, change.at + change.newCount);
	const target = focusTargetInReplacement(blocks, shifted);
	return caretInBlock(children, change.at + target.index, target.offset);
}

/** A container whose bytes map to no leaf (any but a strip container, a table say) keeps the raw
 *  offset, as a leaf does. */
function caretInBlock(children: readonly NodeView[], index: number, offset: number): SettledCaret {
	const block = children[index];
	const leaf = block?.children?.length ? leafAtRawOffset(block, offset) : null;
	return leaf ? { index, path: leaf.path, offset: leaf.offset } : { index, path: [], offset };
}
