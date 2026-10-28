/**
 * The content write: every byte that enters a node goes through `updateNodeContent` after
 * `legalizeWrite` makes it legal for its position. Also re-derives a container's kind from its
 * rebuilt raw (`docs/design/structural-edits.md` § Structural operations).
 */

import type { CstNode, Document } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import {
	unfinishedReadings,
	waitingReading,
	type GrammarView,
	type UnfinishedReading
} from '../schema/block-openers';
import {
	lineOpensAs,
	parseContainerRaw,
	rebuildContainerRaw,
	type BytesReading
} from '../schema/container-raw';
import {
	splitLines,
	documentLineEnding,
	firstDisplayLine,
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import { openLinesAtEnd } from '../core/inline';
import { writtenSpan } from '../core/written-span';
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
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';
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

/** `text` made legal as the bytes of the block at `index`: the prose rule, the kind's `rawWrite`,
 *  then the container's `bodyWrite`, all reading the tree as it stands before the write. */
export function legalizeWrite(
	parent: WriteTarget,
	index: number,
	text: string,
	mode: WriteMode
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
	const stored = bodyRule && bodyCtx ? bodyRule.normalize(own, bodyCtx) : own;
	// A list item takes a typed task marker out of its first paragraph, or gives one back.
	const markerShift = index === 0 && owner ? taskMarkerCaretShift(owner, stored) : 0;
	const storedOffset = (offset: number): number => {
		// A caret on the dropped lines lands at the end of the text above them.
		const inProse = dropped ? Math.min(offset, dropped.text.length) : offset;
		const inOwn = ownRule ? ownRule.mapOffset(prose, inProse, ownCtx) : inProse;
		const inBody = bodyRule && bodyCtx ? bodyRule.mapOffset(own, inOwn, bodyCtx) : inOwn;
		return Math.max(inBody + markerShift, 0);
	};
	return { text: stored, storedOffset } as LegalWrite;
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
	const legal = legalText(body, blockIndex, text);
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
	const legal = legalText(body, blockIndex, text);
	return writeKeepingTaskMarker(body.owner, body.children, blockIndex, sharing, () => {
		const { change, written } = writeLegal(body, blockIndex, legal, grammar);
		return fixUpWrite(body, written, change, grammar, sharing);
	});
}

const legalText = (body: BodyParent, index: number, text: string | LegalWrite): string =>
	typeof text === 'string' ? legalizeWrite(body, index, text, 'literal').text : text.text;

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

/**
 * The written bytes parsed, with an opener the write put on a line of its own given its own closer
 * first, or the next parse and the fix-up would read the blocks below into it.
 */
function closeWrittenConstruct(
	parent: BodyParent,
	blockIndex: number,
	text: string,
	read: FragmentReader,
	readings: readonly UnfinishedReading[]
): { text: string; parsed: Document } {
	const parsed = read(text);
	const closer = openerCloser(parent.children, blockIndex, text, read, readings, () => parsed);
	if (closer === null) return { text, parsed };
	const closed = text + closer;
	return { text: closed, parsed: read(closed) };
}

/** The closing line, ending and all, a write of `text` over child `index` adds for an opener it puts
 *  on a line of its own; null when it leaves none. */
export function writtenOpenerCloser(
	parent: WriteTarget,
	index: number,
	text: string,
	grammar: GrammarView
): string | null {
	const owner = 'owner' in parent ? parent.owner : undefined;
	const read = fragmentReaderAt(owner, index, grammar);
	return openerCloser(parent.children, index, text, read, unfinishedReadings(grammar), () =>
		read(text)
	);
}

function openerCloser(
	children: readonly NodeView[],
	index: number,
	text: string,
	read: FragmentReader,
	readings: readonly UnfinishedReading[],
	readWritten: () => Document
): string | null {
	const next = children[index + 1];
	// The closer is a line of its own, so bytes whose last line is unterminated have nowhere to put
	// one, and an opener the write only exposed reads on as a reload reads it, closer and all.
	const ending = ownTrailingLineEnding(text);
	if (!next || ending === '' || !waitsOnWrittenLine(children[index].raw, text, readings)) {
		return null;
	}
	const parsed = readWritten();
	const opened = parsed.children[parsed.children.length - 1];
	const reading = opened && waitingReading(opened.raw, readings);
	if (!reading?.closer || !opensOnWrittenLine(children[index].raw, text, parsed)) return null;
	if (takesCloserBelow(text, opened, next, read, readings)) return null;
	if (!reading.readsOn && !takesBlocksBelow(children, index, text, parsed, reading, read)) {
		return null;
	}
	const closer = reading.closer(opened.raw) + ending;
	return opensEditableLine(read(text + closer), parsed.children.length - 1) ? closer : null;
}

// A kind that holds child blocks draws its opener line as chrome, not text the caret types in, so
// closing it mid-name would send the rest of the name into its body.
function opensEditableLine(closed: Document, index: number): boolean {
	const kind = closed.children[index]?.kind;
	return kind !== undefined && !mustHoldChild(kind);
}

/** Whether the bytes from some line the write changed on wait for a closer, before any parse:
 *  a keystroke in prose is answered here. */
function waitsOnWrittenLine(
	before: string,
	text: string,
	readings: readonly UnfinishedReading[]
): boolean {
	const span = writtenSpan(before, text);
	for (let at = text.lastIndexOf('\n', span.start - 1) + 1; at <= span.end && at < text.length;) {
		const rest = text.slice(at);
		if (waitingReading(rest, readings) !== null) return true;
		const lineEnd = text.indexOf('\n', at);
		if (lineEnd < 0) break;
		at = lineEnd + 1;
	}
	return false;
}

/** Whether an opener typed back onto its body takes the closer flush beneath it; one typed on its
 *  own line, or with a blank line under it, gets a closer of its own. */
function takesCloserBelow(
	text: string,
	opened: NodeView,
	next: NodeView,
	read: FragmentReader,
	readings: readonly UnfinishedReading[]
): boolean {
	const hasBody = trimTrailingLineEnding(opened.raw).includes('\n');
	if (!hasBody || next.leadingTrivia !== '') return false;
	const head = read(text + firstDisplayLine(next.raw).text + ownTrailingLineEnding(text));
	const last = head.children[head.children.length - 1];
	return !last || waitingReading(last.raw, readings) === null;
}

/** Whether an opener that only a closer below changes takes blocks in down to one, read at each
 *  block holding a line that may close it, as the fix-up reads them. */
function takesBlocksBelow(
	children: readonly NodeView[],
	index: number,
	text: string,
	parsed: Document,
	reading: UnfinishedReading,
	read: FragmentReader
): boolean {
	const opened = parsed.children.length - 1;
	let bytes = text;
	for (let k = index + 1; k < children.length; k++) {
		const node = children[k];
		bytes += node.leadingTrivia + node.raw;
		if (!splitLines(node.raw).some((line) => reading.mayClose(line.text))) continue;
		const reread = read(bytes).children[opened];
		if (reread && reread.raw.length > parsed.children[opened].raw.length) return true;
	}
	return false;
}

/** Whether the last block of `parsed` opens on a line the write changed in `before`. */
function opensOnWrittenLine(before: string, text: string, parsed: Document): boolean {
	const last = parsed.children[parsed.children.length - 1];
	const start = text.length - parsed.suffix.length - last.raw.length;
	const lineEnd = start + firstDisplayLine(last.raw).text.length;
	const span = writtenSpan(before, text);
	return span.start <= lineEnd && span.end >= start;
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

	const { text: newText, parsed: reparsed } = closeWrittenConstruct(
		parent,
		blockIndex,
		text,
		fragmentReaderAt(parent.owner, blockIndex, grammar),
		unfinishedReadings(grammar)
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
		spliceList(parent, blockIndex, 1, parsed);
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
