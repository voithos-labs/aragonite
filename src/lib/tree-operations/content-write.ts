/**
 * The content write: every byte that enters a node goes through `updateNodeContent` after
 * `legalizeWrite` makes it legal for its position. Also re-derives a container's kind from its
 * rebuilt raw (`docs/design/structural-edits.md` § Structural operations).
 */

import type { CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { unfinishedReadings, type GrammarView } from '../schema/block-openers';
import {
	lineOpensAs,
	parseContainerRaw,
	rebuildContainerRaw,
	type BytesReading
} from '../schema/container-raw';
import { documentLineEnding, ownTrailingLineEnding, type LineEnding } from '../core/lines';
import { openLinesAtEnd } from '../core/inline';
import { assignChildIdsDeep, idsAcrossReread } from '../block-id';
import {
	getBlockKindDescriptor,
	mustHoldChild,
	tryGetBlockKindDescriptor,
	type WriteContext,
	type WriteMode,
	hasOwnOpener
} from '../schema/block-kind-descriptor';
import type { SharingState } from './sharing';
import { resyncChildIds } from './children';
import { replacePreservingFirst, type StructuralChange } from './structural-change';
import { taskMarkerCaretShift, writeKeepingTaskMarker } from './list/reconcile-task';
import { fragmentReaderAt } from './list/task-paragraph';
import {
	NEXT_PROSE_LINE,
	asBody,
	installOwnRaw,
	kindWriteRule,
	type BodyParent,
	type BodyParentArg,
	type NodeParent,
	spliceList
} from './node-primitives';
import { ensureEditableContainers } from '../schema/opened-reading';
import {
	offsetPastClosers,
	withClosers,
	writtenOpenerClosers,
	type WrittenCloser
} from './written-openers';
import { caretInBlocks, fixUpWrite, type FixedUpWrite, type WrittenSlot } from './fix-up/apply';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkWriteInWindow } from '../invariants/structural-descriptor';

export type { FixedUpWrite, WrittenSlot };

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

/** `text` made legal as the bytes of the block at `index`, among the siblings as they stand once it
 *  lands: the prose rule, the kind's `rawWrite`, the container's `bodyWrite`, then a written opener's closer. */
export function legalizeWrite(
	parent: WriteTarget,
	index: number,
	text: string,
	mode: WriteMode,
	grammar: GrammarView
): LegalWrite {
	const node = parent.children[index];
	const owner = 'owner' in parent ? parent.owner : undefined;
	const lineEnding = 'lineEnding' in parent ? parent.lineEnding : documentLineEnding(parent);
	const dropped = droppedOpenLines(node, text);
	const prose = dropped ? dropped.text + text.slice(dropped.end) : text;
	const ownRule = kindWriteRule(node);
	const ownCtx: WriteContext = { node, mode, lineEnding };
	const own = ownRule ? ownRule.normalize(prose, ownCtx) : prose;
	const bodyRule = owner ? tryGetBlockKindDescriptor(owner.kind)?.bodyWrite : undefined;
	// A child's bytes are never the container's own syntax, so the body rule reads them as content.
	const bodyCtx: WriteContext | undefined = owner && { node: owner, mode: 'literal', lineEnding };
	const body = bodyRule && bodyCtx ? bodyRule.normalize(own, bodyCtx) : own;
	const closers = closersFor(parent.children, index, node, body, owner, grammar);
	const stored = withClosers(body, closers);
	// A list item takes a typed task marker out of its first paragraph, or gives one back.
	const markerShift = index === 0 && owner ? taskMarkerCaretShift(owner, stored) : 0;
	const storedOffset = (offset: number): number => {
		// A caret on the dropped lines lands at the end of the text above them.
		const inProse = dropped ? Math.min(offset, dropped.text.length) : offset;
		const inOwn = ownRule ? ownRule.mapOffset(prose, inProse, ownCtx) : inProse;
		const inBody = bodyRule && bodyCtx ? bodyRule.mapOffset(own, inOwn, bodyCtx) : inOwn;
		return Math.max(offsetPastClosers(inBody, closers) + markerShift, 0);
	};
	return { text: stored, storedOffset } as LegalWrite;
}

// A kind with no reading of its own (a table cell, a title row) holds no block opener.
function closersFor(
	children: readonly NodeView[],
	index: number,
	node: NodeView,
	text: string,
	owner: NodeView | undefined,
	grammar: GrammarView
): WrittenCloser[] {
	if (tryGetBlockKindDescriptor(node.kind)?.contextDependentKind) return [];
	const read = fragmentReaderAt(owner, index, grammar);
	return writtenOpenerClosers(children, index, node.raw, text, read, unfinishedReadings(grammar));
}

/** {@link legalizeWrite}'s closers for a write that arrives as blocks, put at child `index` over the
 *  bytes `before` (the block they replace, or nothing for a block moved there). */
export function closeWrittenOpeners(
	target: WriteTarget,
	index: number,
	before: string,
	blocks: readonly CstNode[],
	grammar: GrammarView
): CstNode[] {
	if (blocks.some((block) => tryGetBlockKindDescriptor(block.kind)?.contextDependentKind)) {
		return [...blocks];
	}
	const owner = 'owner' in target ? target.owner : undefined;
	const read = fragmentReaderAt(owner, index, grammar);
	const ends: number[] = [];
	let text = '';
	for (const [k, block] of blocks.entries()) {
		text += (k > 0 ? block.leadingTrivia : '') + block.raw;
		ends.push(text.length);
	}
	const readings = unfinishedReadings(grammar);
	const closers = writtenOpenerClosers(target.children, index, before, text, read, readings);
	const ending = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
	const out = [...blocks];
	for (const closer of closers) {
		const k = ends.indexOf(closer.at);
		if (k < 0) continue;
		const bytes = blocks[k].raw + closer.text;
		const closed = read(bytes).children;
		if (closed.length !== 1) continue;
		// The whole closed bytes, since the reparse splits a trailing blank line off into its suffix.
		const node: CstNode = { ...closed[0], leadingTrivia: blocks[k].leadingTrivia, raw: bytes };
		ensureEditableContainers(node, ending);
		assignChildIdsDeep(node);
		out[k] = node;
	}
	return out;
}

/** The empty lines after a final hard break that a write of `text` over prose block `node` drops,
 *  since a reload reads that break as a backslash; `end` is where they end in `text`. */
export function droppedOpenLines(
	node: NodeView,
	text: string
): { text: string; lines: number; end: number } | null {
	if (!tryGetBlockKindDescriptor(node.kind)?.supportsInline) return null;
	const own = ownTrailingLineEnding(node.raw);
	// A block saved without a final line ending has none to take off, so a last line break is open.
	const end = own && text.endsWith(own) ? text.length - own.length : text.length;
	const open = openLinesAtEnd(text.slice(0, end));
	return open && { text: open.text, lines: open.lines, end };
}

// ── Update Content ──

/** A content write before its fix-up: the change the reparse made, and what was written where. */
export interface UnsettledWrite {
	change: StructuralChange;
	written: WrittenSlot;
}

/**
 * Write and reparse the block, leaving its fix-up to the commit that reports `written`; only a
 * same-kind single-block edit writes in place, so typing keeps the node's identity.
 */
export function writeNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string | LegalWrite,
	grammar: GrammarView,
	sharing: SharingState
): UnsettledWrite {
	const body = asBody(parent);
	const legal = legalText(body, blockIndex, text, grammar);
	// Reconciled before the container's raw rebuild writes the list item's marker.
	return writeKeepingTaskMarker(body.owner, body.children, blockIndex, sharing, () =>
		writeLegal(body, blockIndex, legal, grammar)
	);
}

/**
 * {@link writeNodeContent} plus its fix-up, for a write no commit settles: the keystroke written in
 * place, the trial before it, and a body below a commit's scope. A plain string is made legal here.
 */
export function updateNodeContent(
	parent: BodyParentArg,
	blockIndex: number,
	text: string | LegalWrite,
	grammar: GrammarView,
	sharing: SharingState
): FixedUpWrite {
	const body = asBody(parent);
	const legal = legalText(body, blockIndex, text, grammar);
	return writeKeepingTaskMarker(body.owner, body.children, blockIndex, sharing, () => {
		const { change, written } = writeLegal(body, blockIndex, legal, grammar);
		return fixUpWrite(body, written, change, grammar, sharing);
	});
}

const legalText = (
	body: BodyParent,
	index: number,
	text: string | LegalWrite,
	grammar: GrammarView
): string =>
	typeof text === 'string' ? legalizeWrite(body, index, text, 'literal', grammar).text : text.text;

function writeLegal(
	parent: BodyParent,
	blockIndex: number,
	text: string,
	grammar: GrammarView
): UnsettledWrite {
	// Copied, since an in-place write swaps the node's metadata and children for the new reading's.
	const previous = { ...parent.children[blockIndex] };
	const change = writeParsedContent(parent, blockIndex, text, grammar);
	return { change, written: { index: blockIndex, previous, text } };
}

function writeParsedContent(
	parent: BodyParent,
	blockIndex: number,
	text: string,
	grammar: GrammarView
): StructuralChange {
	const node = parent.children[blockIndex];
	const oldKind = node.kind;
	const oldDescriptor = getBlockKindDescriptor(oldKind);
	const { lineEnding } = parent;

	// A context-dependent kind has no standalone recognizer, so reparsing would downgrade it.
	if (oldDescriptor.contextDependentKind) {
		installOwnRaw(node, text, grammar);
		return { op: 'noop' };
	}

	const reparsed = fragmentReaderAt(parent.owner, blockIndex, grammar)(text);
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
		spliceList(parent, blockIndex, 1, parsed);
		return replacePreservingFirst(blockIndex, 1, parsed.length);
	}

	const newKind = first?.kind ?? 'paragraph';

	// In-place refresh keeps the node's object identity: component, IME state, and inline
	// cache are all keyed on it.
	if (newKind === oldKind) {
		node.raw = text;
		adoptReparsedFields(node, first);
		if (firstBackfilled) rebuildContainerRaw(node, grammar);
		return { op: 'noop' };
	}

	const replacement: CstNode = first ?? { kind: 'paragraph', leadingTrivia: '', raw: text };
	replacement.raw = text;
	replacement.leadingTrivia = node.leadingTrivia;
	if (firstBackfilled) rebuildContainerRaw(replacement, grammar);
	spliceList(parent, blockIndex, 1, [replacement]);
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
	return mustHoldChild(node.kind) && (node.children?.length ?? 0) === 0;
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
	if (!hasOwnOpener(node.kind)) return null;
	const filled: CstNode[] = [];
	const blocks = parseContainerRaw(node.raw, grammar, filled);
	return replaceWithParse(parent, index, blocks, filled, grammar);
}

/** The container at `index` replaced by what its bytes read as, when its position holds that: the
 *  same kind over other children, or one block of another kind that has an opener. */
export function installReading(
	parent: NodeParent,
	index: number,
	reading: BytesReading,
	grammar: GrammarView
): CstNode | null {
	const node = parent.children[index];
	if (!node || reading.outcome === 'kept') return null;
	if (reading.outcome === 'reread') {
		// A child the re-read left alone keeps its id, so the block there stays mounted.
		const children = reading.node.children ?? [];
		reading.node.childIds = idsAcrossReread(node.children ?? [], node.childIds, children);
		return installReplacement(parent, index, reading.node, reading.filled, grammar);
	}
	if (!hasOwnOpener(node.kind)) return null;
	return replaceWithParse(parent, index, reading.blocks, reading.filled, grammar);
}

function replaceWithParse(
	parent: NodeParent,
	index: number,
	parsed: CstNode[],
	filled: readonly CstNode[],
	grammar: GrammarView
): CstNode | null {
	// A container's raw is one block by construction; a multi-block reparse means bytes this
	// function has no position for, left to the edit that owns the mutation.
	if (parsed.length !== 1 || parsed[0].kind === parent.children[index].kind) return null;
	return installReplacement(parent, index, parsed[0], filled, grammar);
}

/** `replacement`, read with the editor's empty paragraphs, takes the position; one the reading
 *  gave a paragraph has its bytes rebuilt around it, or raw and children disagree (G1.1). */
function installReplacement(
	parent: NodeParent,
	index: number,
	replacement: CstNode,
	filled: readonly CstNode[],
	grammar: GrammarView
): CstNode {
	const node = parent.children[index];
	const backfilled = filled.includes(replacement);
	// The position's own `leadingTrivia` is authoritative, so restore the bytes before
	// overwriting it or anything the parse split off the front vanishes with it.
	replacement.raw = node.raw;
	replacement.leadingTrivia = node.leadingTrivia;
	if (backfilled) rebuildContainerRaw(replacement, grammar);
	// A freshly parsed node carries no `childIds`, and the swap reuses the position's component,
	// so undefined keys would reach its nested keyed `{#each}`.
	assignChildIdsDeep(replacement);
	spliceList(parent, index, 1, [replacement]);
	// Write, then re-read through the tree (`unshare.ts` header).
	return parent.children[index];
}

/** Where a caret at `offset` in the written text ends up after the write's merges:
 *  the block holding it and its offset there, counting what a merge above put in front. */
export function settledCaretPosition(
	settled: FixedUpWrite,
	at: number,
	offset: number,
	children: readonly NodeView[]
): { index: number; offset: number } {
	const { change, textStart } = settled;
	if (change.op !== 'replace') return { index: at, offset };
	assertInvariant('write-in-window', () => checkWriteInWindow(change, at));
	const shifted = offset + textStart;
	if (change.newCount <= 1) return { index: change.at, offset: shifted };
	const blocks = children.slice(change.at, change.at + change.newCount);
	const target = caretInBlocks(blocks, shifted);
	return { index: change.at + target.index, offset: target.offset };
}
