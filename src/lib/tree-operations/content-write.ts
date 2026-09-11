/**
 * The content write: every byte that enters a node crosses `updateNodeContent`, the sole
 * re-parse transfer funnel (editor.md § 6, § 8), and the container twin that re-derives a
 * container's kind from its rebuilt raw.
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
import { replacePreservingFirst, type StructuralChange } from './structural-change';
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

/** What a content write settled: its change widened by every fold, and the offset the written
 *  text starts at inside that change's window (nonzero once a fold above absorbed it). */
export interface SettledContent {
	change: StructuralChange;
	textStart: number;
}

/**
 * Update raw and re-parse. A kind change mints the reparsed block into the slot rather than
 * reassigning `kind` in place, and multi-block text mints every parsed block; only a same-kind
 * single-block edit writes in place, so routine typing keeps the node's object identity.
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
	// Same-kind typing INSIDE content must never pay a neighbour reparse.
	if (change.op === 'noop') return { change, textStart: 0 };
	return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing);
}

/**
 * Ask every join the write disturbed and report where the written text ended up: an absorb
 * ABOVE leaves the predecessor standing, so its bytes now sit in front of the text.
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
 * The tracked position as an offset in the settled window's committed text, the space every
 * caret door measures in, where the head block's own leading trivia is outside the window.
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

/** The last block the write left in the slot: a multi-block reparse mints past the first. */
function lastMintedIndex(change: StructuralChange, blockIndex: number): number {
	return change.op === 'replace' ? change.at + change.newCount - 1 : blockIndex;
}

/**
 * The written bytes parsed, with the construct they leave OPEN closed off first: an unterminated
 * construct reads every block below it as its body at the next parse, and the seam settle would
 * converge the live tree to exactly that reading.
 */
function closeWrittenConstruct(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	oldKind: AnyBlockKind,
	grammar: GrammarView | undefined
): { text: string; parsed: Document } {
	// Fragment scope: this is one block's bytes, whatever its position, so a position-scoped
	// kind must not mint here.
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
 * rather than a kind list. Null when the bytes terminate themselves, or when no fence opener
 * explains the absorb (the one family whose closer its opener determines).
 */
function openConstructTerminator(
	text: string,
	blocks: readonly CstNode[],
	grammar: GrammarView | undefined
): string | null {
	// The terminator is a line of its own, so bytes whose last line is still open have none to
	// append to (G4.20's unterminated tail slice, which absorbs nothing while it stands alone).
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
		grammar
	);
	const parsed = reparsed.children;
	const first: CstNode | undefined = parsed[0];
	// A marker-consuming container (a GitHub alert) needs its raw rebuilt from the backfilled
	// body, or G1.1 stale-raw fires.
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

/** A container `ensureEditableContainers` will backfill; read BEFORE the backfill runs. */
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

/** Whether the ambient grammar still leaves `NEXT_PROSE_LINE` an ordinary paragraph. */
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
	// A container's raw is one block by construction; a multi-block reparse means bytes
	// this seam has no slot for, left to the gesture that owns the mutation.
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
 * Where a caret at `offset` in the written text lands once {@link updateNodeContent}'s folds
 * settled: an absorb ABOVE leaves the predecessor holding the bytes, so the slot the gesture
 * named is gone and the offset carries what that predecessor put in front of it.
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
