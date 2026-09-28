/**
 * The content write: every byte that enters a node goes through `updateNodeContent` after
 * `legalizeWrite` makes it legal for its position. Also re-derives a container's kind from its
 * rebuilt raw (`docs/design/editor.md` § Structural operations).
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { isBlankParagraph } from '../core/parser';
import { escalatedFenceLength, matchFenceOpen } from '../core/parsers/fence-syntax';
import { isBlockOpenerRegistered, type GrammarView } from '../schema/block-openers';
import { lineOpensAs, parseContainerRaw, rebuildContainerRaw } from '../schema/container-raw';
import {
	displayLines,
	documentLineEnding,
	firstLineEnding,
	joinDisplayLines,
	ownTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import { assignChildIdsDeep } from '../block-id';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor,
	type WriteContext,
	type WriteMode
} from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { resyncChildIds } from './children';
import { spliceMany } from './splice-many';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { taskMarkerCaretShift, writeKeepingTaskMarker } from './list/reconcile-task';
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';
import {
	NEXT_PROSE_LINE,
	ensureEditableContainers,
	installOwnRaw,
	parentLineEnding,
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

// ── Making written bytes legal ──

declare const legalWrite: unique symbol;

/**
 * Text made legal as a block's bytes by {@link legalizeWrite}, the one place that builds it, so
 * a write that carries one has passed the kind's rule and its container's exactly once.
 */
export interface LegalWrite {
	readonly text: string;
	/** Where an offset into the text as the writer wrote it lands in the stored `text`. */
	storedOffset(offset: number): number;
	readonly [legalWrite]: true;
}

/** What {@link legalizeWrite} reads of a block's parent: its container and line ending. */
export type WriteTarget =
	| {
			readonly children: readonly NodeView[];
			readonly owner: NodeView | undefined;
			readonly lineEnding: LineEnding;
	  }
	| DocumentView;

/**
 * `text` made legal as the bytes of the block at `index`: its kind's `rawWrite`, then the
 * container's `bodyWrite`, both reading the tree as it stands before the write.
 */
export function legalizeWrite(
	parent: WriteTarget,
	index: number,
	text: string,
	mode: WriteMode
): LegalWrite {
	const node = parent.children[index];
	const owner = 'owner' in parent ? parent.owner : undefined;
	const lineEnding = 'lineEnding' in parent ? parent.lineEnding : documentLineEnding(parent);
	const ownRule = tryGetBlockKindDescriptor(node.kind)?.rawWrite;
	const ownCtx: WriteContext = { node, mode, lineEnding };
	const own = ownRule ? ownRule.normalize(text, ownCtx) : text;
	const bodyRule = owner ? tryGetBlockKindDescriptor(owner.kind)?.bodyWrite : undefined;
	// A child's bytes are never the container's own syntax, so the body rule reads them as content.
	const bodyCtx: WriteContext | undefined = owner && { node: owner, mode: 'literal', lineEnding };
	const stored = bodyRule && bodyCtx ? bodyRule.normalize(own, bodyCtx) : own;
	// A list item takes a typed task marker out of its first paragraph, or gives one back.
	const markerShift = index === 0 && owner ? taskMarkerCaretShift(owner, stored) : 0;
	const storedOffset = (offset: number): number => {
		const inOwn = ownRule ? ownRule.mapOffset(text, offset, ownCtx) : offset;
		const inBody = bodyRule && bodyCtx ? bodyRule.mapOffset(own, inOwn, bodyCtx) : inOwn;
		return Math.max(inBody + markerShift, 0);
	};
	return { text: stored, storedOffset } as LegalWrite;
}

// ── Update Content ──

/** What a content write produced once its neighbours were fixed up: its change widened by every
 *  merge, and the offset the written text starts at inside that change's window (nonzero once a
 *  merge above absorbed it). */
export interface SettledContent {
	change: StructuralChange;
	textStart: number;
}

/**
 * Write and reparse the block; only a same-kind single-block edit writes in place, so typing keeps
 * the node's identity. A plain string is made legal here; a {@link LegalWrite} already is.
 */
export function updateNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string | LegalWrite,
	grammar: GrammarView,
	sharing?: SharingState
): SettledContent {
	const legal =
		typeof text === 'string' ? legalizeWrite(parent, blockIndex, text, 'literal').text : text.text;
	// Reconciled before the container's raw rebuild writes the list item's marker.
	const owner = 'owner' in parent ? parent.owner : undefined;
	return writeKeepingTaskMarker(owner, parent.children, blockIndex, sharing, () =>
		writeAndSettleContent(parent, blockIndex, legal, grammar, sharing)
	);
}

function writeAndSettleContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar: GrammarView,
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
	// Same-kind typing skips the neighbour reparse unless the first line's indent moved, a blank line
	// stays blank, or this block or the one above reads the lines below it (editor.md § 8).
	if (change.op === 'noop' && !wasBlank && !indentMoved && !readerBeside(parent, blockIndex)) {
		return { change, textStart: 0 };
	}
	return settleWriteSeams(parent, blockIndex, lastWritten, change, sharing, grammar);
}

const leadingIndent = (text: string): string => /^[ \t]*/.exec(text)![0];

const readsFollowingLines = (node: NodeView | undefined): boolean =>
	node !== undefined && tryGetBlockKindDescriptor(node.kind)?.readsFollowingLines === true;

/** Whether the written block or the one right above it reads the lines below it with no blank
 *  line between, where a write that kept its kind can still move the join. */
function readerBeside(parent: BodyParentArg, blockIndex: number): boolean {
	const { children } = parent;
	const below = children[blockIndex + 1];
	return (
		(children[blockIndex].leadingTrivia === '' && readsFollowingLines(children[blockIndex - 1])) ||
		(below?.leadingTrivia === '' && readsFollowingLines(children[blockIndex]))
	);
}

/**
 * Merge across every join the write disturbed, and report where the written text ended up, since
 * a merge into the block above puts that block's bytes in front of it.
 */
function settleWriteSeams(
	parent: BodyParentArg,
	blockIndex: number,
	lastWritten: number,
	change: StructuralChange,
	sharing: SharingState | undefined,
	grammar: GrammarView
): SettledContent {
	const tracked: TrackedPosition = { index: blockIndex, offset: 0 };
	const settled = absorbWindowSeams(
		parent,
		blockIndex,
		lastWritten - blockIndex + 1,
		blockIndex,
		change,
		grammar,
		sharing,
		tracked
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
 * The written bytes parsed, with a construct they leave open closed first, or the next parse and
 * the neighbour merge would read every block below it as its body.
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
 * The closing line the bytes need when their last construct runs to end of file; null when they
 * close themselves, or no fence opener explains the run.
 */
function openConstructTerminator(
	text: string,
	blocks: readonly CstNode[],
	read: FragmentReader
): string | null {
	// The closer is a line of its own, so bytes whose last line is unterminated have nowhere to
	// put one: an unterminated tail slice absorbs nothing while it stands alone.
	const ending = ownTrailingLineEnding(text);
	if (ending === '' || blocks.length === 0) return null;
	const probe = read(text + ending + NEXT_PROSE_LINE + ending);
	if (probe.children.length !== blocks.length) return null;
	const [openerLine, ...bodyLines] = displayLines(blocks[blocks.length - 1].raw);
	const opener = matchFenceOpen(openerLine.text);
	if (!opener) return null;
	const body = joinDisplayLines(bodyLines);
	const run = escalatedFenceLength(body, opener.marker, opener.length);
	return opener.indent + opener.marker.repeat(run) + ending;
}

function writeParsedContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string,
	grammar: GrammarView
): StructuralChange {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;
	const oldDescriptor = getBlockKindDescriptor(oldKind);
	const lineEnding = parentLineEnding(parent);

	// A context-dependent kind has no standalone recognizer, so reparsing would downgrade it.
	if (oldDescriptor.contextDependentKind) {
		installOwnRaw(node, text, grammar);
		return { op: 'noop' };
	}

	const { text: newText, parsed: reparsed } = closeWrittenConstruct(
		parent,
		blockIndex,
		text,
		oldKind,
		fragmentReaderAt('owner' in parent ? parent.owner : undefined, blockIndex, grammar)
	);
	const parsed = reparsed.children;
	const first: CstNode | undefined = parsed[0];
	// A marker-consuming container (a GitHub alert) needs its raw rebuilt from the backfilled
	// body, or raw and children disagree (G1.1).
	const firstBackfilled = !!first && isEmptyEditableContainer(first);
	if (first) ensureEditableContainers(first, lineEnding);

	// Blank lines at the start of the text go into the first block's raw (as in the single-block
	// case); the rest keep their own separators.
	if (parsed.length > 1) {
		const rest = parsed.slice(1);
		for (const sibling of rest) ensureEditableContainers(sibling, lineEnding);
		first.raw = first.leadingTrivia + first.raw;
		first.leadingTrivia = node.leadingTrivia;
		if (firstBackfilled) rebuildContainerRaw(first, grammar);
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
		if (firstBackfilled) rebuildContainerRaw(node, grammar);
		return { op: 'noop' };
	}

	const replacement: CstNode = first ?? { kind: 'paragraph', leadingTrivia: '', raw: newText };
	replacement.raw = newText;
	replacement.leadingTrivia = node.leadingTrivia;
	if (firstBackfilled) rebuildContainerRaw(replacement, grammar);
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

// ── Container kind re-derivation ──

/** Whether the grammar in effect still leaves `NEXT_PROSE_LINE` an ordinary paragraph. */
export function probeLineOpensAsProse(grammar: GrammarView): boolean {
	return lineOpensAs(NEXT_PROSE_LINE, grammar) === 'paragraph';
}

/**
 * Replace the container at `index` when its rebuilt raw parses as a different kind; only a kind
 * with an opener qualifies, since registering one claims `readBlocks(raw)` reproduces the kind.
 */
export function reclassifyContainer(
	parent: NodeParent,
	index: number,
	grammar: GrammarView
): CstNode | null {
	const node = parent.children[index];
	if (!node || !tryGetBlockKindDescriptor(node.kind)?.isContainer) return null;
	if (!isBlockOpenerRegistered(node.kind)) return null;
	return replaceWithParse(parent, index, parseContainerRaw(node.raw, grammar), grammar);
}

/** The container at `index` replaced by `parsed`, its bytes' reading, when that is one block of
 *  another kind; only a kind with an opener qualifies, as in {@link reclassifyContainer}. */
export function reclassifyFromParse(
	parent: NodeParent,
	index: number,
	parsed: CstNode[],
	grammar: GrammarView
): CstNode | null {
	const node = parent.children[index];
	if (!node || !isBlockOpenerRegistered(node.kind)) return null;
	return replaceWithParse(parent, index, parsed, grammar);
}

function replaceWithParse(
	parent: NodeParent,
	index: number,
	parsed: CstNode[],
	grammar: GrammarView
): CstNode | null {
	const node = parent.children[index];
	// A container's raw is one block by construction; a multi-block reparse means bytes this
	// function has no position for, left to the edit that owns the mutation.
	if (parsed.length !== 1 || parsed[0].kind === node.kind) return null;

	const replacement = parsed[0];
	const backfilled = isEmptyEditableContainer(replacement);
	// A container spanning lines holds the document's ending in its bytes; only a one-line
	// container, the last line of a document, falls back to LF.
	ensureEditableContainers(replacement, firstLineEnding(node.raw) ?? '\n');
	// The position's own `leadingTrivia` is authoritative, so restore the bytes before
	// overwriting it or anything the parse split off the front vanishes with it.
	replacement.raw = node.raw;
	replacement.leadingTrivia = node.leadingTrivia;
	if (backfilled) rebuildContainerRaw(replacement, grammar);
	// A freshly parsed node carries no `childIds`, and the swap reuses the position's component,
	// so undefined keys would reach its nested keyed `{#each}`.
	assignChildIdsDeep(replacement);
	parent.children[index] = replacement;
	// Write, then re-read through the tree (`unshare.ts` header).
	return parent.children[index];
}

/** Where a caret at `offset` in the written text ends up after {@link updateNodeContent}'s merges:
 *  the block holding it and its offset there, counting what a merge above put in front. */
export function settledCaretPosition(
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
