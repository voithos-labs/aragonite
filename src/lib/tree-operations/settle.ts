/**
 * Recomputes the blank-line separators an edit left stale, merges neighbours that would re-read
 * as one block on reload, and deletes a block on top of both (`docs/design/syntax-tree.md` § Blank
 * lines). Each takes the body with its owner, since the owner's fence lines and title decide where
 * a separator may sit, and writes only through `writeSeparator` and `writeWrapSlot`.
 */

import type { CstNode, Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph, readBlocks, type ContainerBodyWrap } from '../core/parser';
import {
	firstLineEnding,
	ownTrailingLineEnding,
	splitLines,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import { tableTakesLine } from '../core/parsers/table';
import { devWarn } from '../dev-warn';
import { assignChildIdsDeep } from '../block-id';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { GrammarView } from '../schema/block-openers';
import { dropChildSpans } from '../schema/child-spans';
import { assertInvariant } from '../assert';
import { checkStructuralDescriptor } from '../invariants/structural-descriptor';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { lacksSublistSeparator } from './list/sublist-separator';
import { spliceChildren } from './children';
import { spliceMany } from './splice-many';
import { applyStructuralChangeToIdsRefs, type StructuralChange } from './structural-change';
import {
	asBody,
	bodyUnder,
	ensureEditableContainers,
	type BodyParent,
	type BodyParentArg
} from './node-primitives';

// ── Writes ──

/**
 * The one separator write: the child copied out of the undo snapshot, then its line written. The
 * owner's child spans go first, since they describe the bytes being rewritten.
 */
function writeSeparator(
	body: BodyParent,
	index: number,
	trivia: string,
	sharing: SharingState
): void {
	retireChildSpans(body);
	ensureUnsharedChild(body, index, sharing).leadingTrivia = trivia;
}

/** A write to the blank line a fence line strips, kept on the owner beside its body. */
function writeWrapSlot(body: BodyParent, slot: 'innerPrefix' | 'innerSuffix', line: string): void {
	retireChildSpans(body);
	const slots = body.owner;
	if (!slots) return;
	if (slot === 'innerPrefix') slots.innerPrefix = line;
	else slots.innerSuffix = line;
}

// ── Separators ──

/**
 * Drop the separator at `index` where nothing needs one: at the body head, or below a blank
 * block, where the parser would read the extra line as one more empty paragraph.
 */
export function clearRedundantSeparator(
	body: BodyParent,
	index: number,
	sharing: SharingState
): void {
	const node = body.children[index];
	if (!node || node.leadingTrivia === '') return;
	const bodyStart = bodyStartIndex(body);
	if (index < bodyStart) return;
	const predecessor = index > bodyStart ? body.children[index - 1] : undefined;
	if (predecessor !== undefined && !isBlankParagraph(predecessor)) return;
	const freed = node.leadingTrivia;
	writeSeparator(body, index, '', sharing);
	absorbWrapPrefix(body, bodyStart, index, freed);
}

/**
 * A blank block is itself a blank line, so it and its follower share one separator (G2.13). The
 * follower's is kept, so filling the blank block later still finds the follower separated.
 */
export function dropDoubledSeparator(body: BodyParent, index: number, sharing: SharingState): void {
	const node = body.children[index];
	if (!node || node.leadingTrivia === '' || !isBlankParagraph(node)) return;
	if ((body.children[index + 1]?.leadingTrivia ?? '') === '') return;
	writeSeparator(body, index, '', sharing);
}

/**
 * The separator a block takes back when it stops being blank: its own blank line was what stood
 * between it and a non-blank predecessor. Call when the block is filled.
 */
export function restoreSeparatorOnFill(
	body: BodyParent,
	index: number,
	sharing: SharingState
): void {
	const node = body.children[index];
	if (!node || node.leadingTrivia !== '' || isBlankParagraph(node)) return;
	mintSeparator(body, index, sharing);
}

/**
 * The separator the block below a consumed blank line takes back, skipped for a blank block whose
 * follower already holds one, since the two share it (G2.13).
 */
export function restoreSeparatorAfterBlank(
	body: BodyParent,
	index: number,
	sharing: SharingState
): void {
	const { children } = body;
	const node = children[index];
	if (!node || node.leadingTrivia !== '') return;
	if (isBlankParagraph(node) && (children[index + 1]?.leadingTrivia ?? '') !== '') return;
	mintSeparator(body, index, sharing);
}

/**
 * A block turned blank joins a run that, with its follower, must carry exactly one separating line;
 * a standing line is kept, and a new one goes at the run's head, the only place one may sit.
 */
export function settleSeparatorOnBlank(
	body: BodyParent,
	index: number,
	sharing: SharingState
): void {
	const { children } = body;
	const node = children[index];
	if (!node || !isBlankParagraph(node)) return;
	const bodyStart = bodyStartIndex(body);
	let start = index;
	while (start > bodyStart && isBlankParagraph(children[start - 1])) start--;
	let end = index;
	while (end + 1 < children.length && isBlankParagraph(children[end + 1])) end++;
	const standing: number[] = [];
	for (let i = start; i <= Math.min(end + 1, children.length - 1); i++) {
		if (children[i].leadingTrivia !== '') standing.push(i);
	}
	// A fence line at either end of the run strips one blank line into `innerPrefix`/`innerSuffix`
	// on top of the run's own count when prose sits on the other side; an all-blank body needs none.
	const wrap = bodyWrapOf(body);
	const slots = body.owner;
	const bodyEnd = children.length - 1;
	// A run of two or more that is the whole body sits against both fence lines, and the reload
	// strips a line into each of `innerPrefix` and `innerSuffix`, so the run supplies both.
	const twoPeelBody =
		!!slots &&
		wrap?.afterOpenerLine === true &&
		wrap.beforeCloserLine === true &&
		start === bodyStart &&
		end === bodyEnd &&
		start < end;
	const tailBelowProse = start > bodyStart && end === bodyEnd;
	if (slots && wrap?.beforeCloserLine && (tailBelowProse || twoPeelBody) && !slots.innerSuffix) {
		// A blank block's bytes are its line ending.
		writeWrapSlot(body, 'innerSuffix', ownTrailingLineEnding(children[end].raw));
	}
	// The reverse: beside a lone blank block that is the whole body, the closer strips no line of
	// its own apart from the opener's, so the run gives the extra line back.
	const loneBlankBody = start === bodyStart && end === bodyEnd && start === end;
	if (slots && loneBlankBody && slots.innerSuffix && (slots.innerPrefix || standing.length > 0)) {
		writeWrapSlot(body, 'innerSuffix', '');
	}
	const headUnderWrap =
		!!slots && wrap?.afterOpenerLine === true && start === bodyStart && end < bodyEnd;
	// A line already standing is the one the reload strips against the opener, so taking another
	// into `innerPrefix` would add a line; a `twoPeelBody` keeps its lines in the wrap fields.
	const takesOpenerPeel = twoPeelBody || (headUnderWrap && standing.length === 0);
	if (slots && takesOpenerPeel && !slots.innerPrefix) {
		writeWrapSlot(body, 'innerPrefix', ownTrailingLineEnding(children[start].raw));
	}
	// Under the opener the run keeps exactly one stripped line, in `innerPrefix` or standing;
	// elsewhere a run with nothing above it separates nothing, so every line is a block.
	let wanted: number;
	if (twoPeelBody) wanted = 0;
	else if (headUnderWrap) wanted = slots?.innerPrefix ? 0 : 1;
	else wanted = start > 0 || wrap?.afterOpenerLine ? 1 : 0;
	if (standing.length < wanted) {
		mintSeparator(body, start, sharing);
	} else {
		for (const at of standing.slice(wanted)) writeSeparator(body, at, '', sharing);
	}
	materializeTailSuffix(body, sharing);
}

/**
 * The parser keeps a blank line beside a fence line in `innerPrefix`/`innerSuffix` only when body
 * content sits past it, so an emptied body keeps neither, or it reloads with an extra blank block.
 */
function dropWrapOfEmptiedBody(body: BodyParent): void {
	const slots = body.owner;
	if (!slots || !bodyWrapOf(body)) return;
	if (body.children.length > bodyStartIndex(body)) return;
	if (slots.innerPrefix) writeWrapSlot(body, 'innerPrefix', '');
	if (slots.innerSuffix) writeWrapSlot(body, 'innerSuffix', '');
}

/**
 * A tail block that stops being blank gives back the `innerSuffix` line {@link
 * settleSeparatorOnBlank} lent it, or the container emits a line nobody typed.
 */
export function releaseWrapPeel(body: BodyParent, index: number): void {
	const { children } = body;
	if (children.length === 0 || !body.owner?.innerSuffix) return;
	if (!bodyWrapOf(body)?.beforeCloserLine) return;
	if (index < children.length - 1) return;
	if (isBlankParagraph(children[children.length - 1])) return;
	writeWrapSlot(body, 'innerSuffix', '');
}

/**
 * A body's trailing blank line stays in `suffix`/`innerSuffix` only while the tail block is
 * non-blank; under a blank tail the reload reads it as a paragraph, so it becomes a block here.
 */
function materializeTailSuffix(body: BodyParent, sharing: SharingState): number {
	const { children } = body;
	const slot = tailSuffixSlotOf(body);
	const suffix = slot?.read();
	if (!slot || !suffix) return 0;
	// An emptied body has no tail block for the line to attach to, so the line is the body's
	// whole content and the reload reads it as the one block there is.
	if (children.length > 0 && !isBlankParagraph(children[children.length - 1])) return 0;
	const minted: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: suffix };
	sharing.stamp(minted);
	// A new child moves the count, which the owner's child spans are laid out against.
	retireChildSpans(body);
	children.push(minted);
	slot.clear();
	return 1;
}

/**
 * Where a body keeps its trailing blank line. A closer line strips a line of its own, which
 * {@link settleSeparatorOnBlank} reconciles, so a body under one has no such slot here.
 */
function tailSuffixSlotOf(body: BodyParent): { read: () => string; clear: () => void } | undefined {
	if (body.suffix !== undefined) {
		return { read: () => body.suffix ?? '', clear: () => (body.suffix = '') };
	}
	const { owner } = body;
	const wrap = bodyWrapOf(body);
	if (!owner || wrap?.beforeCloserLine) return undefined;
	// An all-blank body under an opener line gives its first line to the opener on reload, which
	// is the one the trailing line would have added.
	const { children } = body;
	const openerTakesLine =
		wrap?.afterOpenerLine === true &&
		!owner.innerPrefix &&
		children.length > 0 &&
		children.every(isBlankParagraph);
	if (openerTakesLine) return undefined;
	return {
		read: () => owner.innerSuffix ?? '',
		clear: () => writeWrapSlot(body, 'innerSuffix', '')
	};
}

// ── Settling a spliced window ──

/** Recompute the separators around a splice, then merge neighbours that now read as one block.
 *  `removed` is the only record of which blocks were blank; `tracked` follows the merges. */
function settleSplicedWindow(
	body: BodyParent,
	at: number,
	removed: readonly CstNode[],
	vacated: string,
	added: number,
	change: StructuralChange,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition
): StructuralChange {
	// Read before the branches below: `settleSeparatorOnBlank` can append the tail line as a
	// block, and a count read after it would leave that growth outside the reported window.
	const beforeMint = body.children.length;
	handDownVacatedSeparator(body, at, vacated, sharing);
	clearRedundantSeparator(body, at, sharing);
	if (removed.some(isBlankParagraph)) {
		// Both ends: the removed blank line was this position's own separator and the one the
		// block below stood on.
		restoreSeparatorAfterBlank(body, at, sharing);
		if (added > 0) restoreSeparatorAfterBlank(body, at + added, sharing);
		releaseWrapPeel(body, at + Math.max(added - 1, 0));
	} else {
		settleSeparatorOnBlank(body, at + Math.max(added - 1, 0), sharing);
	}
	settleEmptyMarkerLists(body, at, added, sharing);
	dropWrapOfEmptiedBody(body);
	// Unconditional, and only here: a delete window at the tail names no surviving block, and
	// the question is about the body's last block whatever the window.
	materializeTailSuffix(body, sharing);
	const widened = widenForTailMint(change, beforeMint, body.children.length);
	// Merging neighbours is part of settling, not a rule each caller repeats, so a new caller
	// inherits it. A write that reports `noop` splices no window and is asked nothing.
	const absorbed = absorbWindowSeams(
		body,
		at,
		added,
		at,
		widened,
		grammar,
		sharing,
		tracked,
		// A one-block window names the block whose bytes changed, which lets the join above it be
		// refused on that block's first line alone; a wider window names no single block.
		added === 1 ? at : undefined
	).change;
	// The body's trailing line is asked again: a merge can turn the last block blank, and a
	// blank last block is what makes that line a block of its own.
	const beforeTailMint = body.children.length;
	materializeTailSuffix(body, sharing);
	return widenForTailMint(absorbed, beforeTailMint, body.children.length);
}

/**
 * A list landing under a paragraph with an empty first item, or left there by the splice, takes
 * the blank line that keeps it a list; typing writes the same line when it rebuilds the list.
 */
function settleEmptyMarkerLists(
	body: BodyParent,
	at: number,
	added: number,
	sharing: SharingState
): void {
	for (let i = at; i <= at + added && i < body.children.length; i++) {
		if (lacksSublistSeparator(body.children, i)) mintSeparator(body, i, sharing);
	}
}

/** The block that takes the vacated position inherits its separator when it has none of its own
 *  ({@link deleteNode}'s rule). */
function handDownVacatedSeparator(
	body: BodyParent,
	at: number,
	vacated: string,
	sharing: SharingState
): void {
	const heir = body.children[at];
	if (vacated === '' || !heir || heir.leadingTrivia !== '') return;
	writeSeparator(body, at, vacated, sharing);
}

/**
 * The commit's entry point: recompute the separators around `change`'s window against `before`,
 * the children before the mutation. A node that survives inside the window counts as kept.
 */
export function settleSeparator(
	body: BodyParent,
	before: readonly CstNode[],
	change: StructuralChange,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition
): StructuralChange {
	const window = splicedWindow(change);
	const { children } = body;
	if (!window) return change;
	// Checked here, before any branch: a window the mutation mis-derived reads `before` out of
	// bounds and hands the branches a negative span, which each would silently clamp.
	assertInvariant('structural-descriptor', () => checkStructuralDescriptor(change, before.length));
	const survivors = new Set(children.slice(window.at, window.at + window.added));
	const removed = before
		.slice(window.at, window.at + window.removed)
		.filter((node) => !survivors.has(node));
	// Only a block removed from the window's first position leaves a separator behind there; one
	// absorbed below a surviving block (a forward join) takes its separator with it.
	const first = before[window.at];
	const vacated = first && !survivors.has(first) ? first.leadingTrivia : '';
	return settleSplicedWindow(
		body,
		window.at,
		removed,
		vacated,
		window.added,
		change,
		grammar,
		sharing,
		tracked
	);
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
 * {@link settleSeparator} for a splice outside a commit scope, into a container found by walking
 * the live tree; the owner's `childIds` stay in step.
 */
export function spliceChildrenSettled(
	parent: CstNode | Document,
	at: number,
	removeCount: number,
	replacement: CstNode[],
	grammar: GrammarView,
	sharing: SharingState,
	lineEnding: LineEnding
): void {
	const children = parent.children;
	if (!children || at < 0 || at > children.length) return;
	const removed = children.slice(at, at + removeCount);
	// The parent, not a body built over it: the document carries an id array only while a caller
	// borrows one to track this splice.
	spliceChildren(parent as CstNode, at, removeCount, replacement);
	// `noop` goes in so the result describes the fix-up alone: `spliceChildren` already applied
	// this function's own splice to `childIds`, and outside a commit scope nothing else writes them.
	const settled = settleSplicedWindow(
		bodyUnder(parent, lineEnding),
		at,
		removed,
		removed[0]?.leadingTrivia ?? '',
		replacement.length,
		{ op: 'noop' },
		grammar,
		sharing
	);
	const ids = (parent as CstNode).childIds;
	if (ids) applyStructuralChangeToIdsRefs(settled, ids, new Array(ids.length));
}

/** What a merge of neighbours absorbed; `span + eaten` is the block count before the merge, the
 *  figure a change descriptor reports. */
interface SeamAbsorption {
	at: number;
	span: number;
	eaten: number;
	spliced: boolean;
}

/** A byte position the merges keep updated, written in place since each merge re-divides the
 *  bytes into blocks. */
export interface TrackedPosition {
	index: number;
	offset: number;
}

/**
 * Merge neighbours while their joined bytes reload as fewer blocks or move content into the head;
 * blank lines don't end a container, so the window starts at the nearest non-blank block above.
 */
export function absorbSeamReading(
	body: BodyParent,
	seamLeft: number,
	floor: number,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition,
	headProbe?: number,
	onBeforeSplice?: () => void
): SeamAbsorption {
	const read = (bytes: string) => readBlocks(bytes, { grammar, scope: 'fragment' });
	const { children } = body;
	if (seamLeft < 0) return { at: 0, span: 0, eaten: 0, spliced: false };
	let left = seamLeft;
	while (left > floor && isBlankParagraph(children[left])) left--;
	const at = left;
	let span = seamLeft - at + 1;
	let eaten = 0;
	let spliced = false;
	// Only on the first pass: a merge re-divides the window, so the index is stale after one.
	let probe = headProbe;
	for (;;) {
		// The window's far edge crosses a blank run too: the absorbed content sits on the run's
		// far side (a list continues into indented code across any number of blank lines).
		let right = at + span;
		while (right < children.length && isBlankParagraph(children[right])) right++;
		const window = children.slice(at, Math.min(right + 1, children.length));
		if (window.length <= span || window.length < 2) break;
		if (separateTableFollower(body, right, sharing, grammar)) break;
		// A context-dependent kind has no standalone reading, so a join touching it cannot be asked.
		if (window.some((node) => tryGetBlockKindDescriptor(node.kind)?.contextDependentKind)) break;
		if (probe !== undefined && declinesOnHeadLine(window, probe - at, read)) break;
		probe = undefined;
		const bytes = joinedWindowBytes(window, window.length);
		const reparsed = read(bytes);
		const blocks = reparsed.children;
		// Content blocks only: the blank lines an absorbed block held come back as blank blocks.
		if (blocks.length === 0 || contentCount(blocks) > contentCount(window)) break;
		// A count that did not drop is still a merge when the head took content from the block
		// below: a blank run inside that block stays blank blocks while the rest moves up.
		if (blocks.length >= window.length && !headTookContent(blocks[0], window)) break;
		// A merge may promote the head beyond what its bytes carry alone (a paragraph under the
		// setext underline below it), so what must survive is the head's own reading, not its kind.
		if (blocks[0].kind !== window[0].kind && !readsAsItselfAlone(window[0], read)) break;
		onBeforeSplice?.();
		absorbFragmentPeel(body, at + window.length, reparsed.suffix, blocks, sharing);
		blocks[0].leadingTrivia = window[0].leadingTrivia;
		// The window joins two blocks at least, so its bytes hold the document's line ending.
		const lineEnding = firstLineEnding(bytes) ?? '\n';
		for (const block of blocks) {
			ensureEditableContainers(block, lineEnding);
			sharing.stamp(block);
			assignChildIdsDeep(block);
		}
		if (tracked) retrackThroughFold(tracked, at, window, blocks);
		// The merge re-divides the owner's children, which its child spans are laid out against.
		retireChildSpans(body);
		spliceMany(children, at, window.length, blocks);
		eaten += window.length - blocks.length;
		span = blocks.length;
		spliced = true;
	}
	return { at, span, eaten, spliced };
}

/**
 * Give a block an edit left right under a table a blank line, or the reload reads its first line
 * as one more row; the edit made the block, so it stays that block.
 */
function separateTableFollower(
	body: BodyParent,
	index: number,
	sharing: SharingState,
	grammar: GrammarView
): boolean {
	const follower = body.children[index];
	if (body.children[index - 1]?.kind !== 'table' || follower.leadingTrivia !== '') return false;
	// All of the follower's lines, not its first alone: an opener can need a later one to open.
	const lines = splitLines(follower.raw);
	if (lines.length === 0) return false;
	if (!tableTakesLine(lines, 0, lines.length, grammar)) return false;
	mintSeparator(body, index, sharing);
	return true;
}

const contentCount = (nodes: readonly CstNode[]): number =>
	nodes.filter((node) => !isBlankParagraph(node)).length;

/** Whether the reparse moved content into the head: more than the separating blank line, or,
 *  for a container, that line alone, since its body reads an indented one as its own. */
function headTookContent(head: CstNode, window: readonly CstNode[]): boolean {
	const grew = head.raw.length - window[0].raw.length;
	return grew > window[1].leadingTrivia.length || (head.children !== undefined && grew > 0);
}

/** Whether a block's own bytes read back as that block. A container's children never do (an
 *  item's bytes read as a list), which keeps them out of the merge. */
function readsAsItselfAlone(node: CstNode, read: (bytes: string) => Document): boolean {
	const alone = read(node.raw).children;
	return alone.length === 1 && alone[0].kind === node.kind;
}

/**
 * A cheap refusal for a window ending in the changed block, parsing only that block's first line:
 * block parsing scans lines left to right, so a block that opens here opens in the full join too.
 */
function declinesOnHeadLine(
	window: readonly CstNode[],
	member: number,
	read: (bytes: string) => Document
): boolean {
	if (member <= 0 || member !== window.length - 1) return false;
	const raw = window[member].raw;
	const nl = raw.indexOf('\n');
	const joined =
		joinedWindowBytes(window, member) +
		window[member].leadingTrivia +
		(nl < 0 ? raw : raw.slice(0, nl + 1));
	return read(joined).children.length >= window.length;
}

function joinedWindowBytes(window: readonly CstNode[], count: number): string {
	let joined = window[0].raw;
	for (let i = 1; i < count; i++) joined += window[i].leadingTrivia + window[i].raw;
	return joined;
}

/**
 * Where a byte position inside the merged window ends up: the merge's reparse re-divides the
 * joined bytes, and a position past the window only shifts by the blocks the merge ate.
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
	// The offset walk mirrors {@link joinedWindowBytes}.
	let joined = tracked.offset;
	for (let i = 0; i < member; i++) {
		joined += (i === 0 ? 0 : window[i].leadingTrivia.length) + window[i].raw.length;
	}
	if (member > 0) joined += window[member].leadingTrivia.length;
	const landed = focusTargetInReplacement(blocks, joined);
	tracked.index = at + landed.index;
	tracked.offset = landed.offset;
}

/** The block a caret offset into the committed bytes falls in, and its offset there. An offset in
 *  the blank lines between blocks lands at the next block's start. */
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

/** What settling a splice produced: its change widened by every merge, and where a tracked
 *  index ended up. */
export interface SettledSplice {
	change: StructuralChange;
	landing: number;
}

/** Merge across every join the splice at `at` disturbed, the joins inside the window included,
 *  since a move can break a join that was correct. `headProbe` names the one changed block. */
export function absorbWindowSeams(
	body: BodyParent,
	at: number,
	added: number,
	landing: number,
	change: StructuralChange,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition,
	headProbe?: number,
	onBeforeSplice?: () => void
): SettledSplice {
	let settled: SeamAbsorption | null = null;
	let moved = landing;
	let seamLeft = at - 1;
	let last = at + added - 1;
	while (seamLeft <= last) {
		const seam = absorbSeamReading(
			body,
			seamLeft,
			0,
			grammar,
			sharing,
			tracked,
			settled ? undefined : headProbe,
			onBeforeSplice
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

/** Two merges as one window, which is what a change descriptor reports. The walk is left to
 *  right, so `later` never starts above `earlier`'s post-splice span. */
function unionAbsorptions(earlier: SeamAbsorption, later: SeamAbsorption): SeamAbsorption {
	return {
		at: earlier.at,
		span: later.at + later.span - earlier.at,
		eaten: earlier.eaten + later.eaten,
		spliced: true
	};
}

/** Where `index` sits once `seam` merged: a position inside the absorbed span collapses into it. */
function indexAfterAbsorb(index: number, seam: SeamAbsorption): number {
	if (index < seam.at) return index;
	const absorbedTo = seam.at + seam.span + seam.eaten;
	return index >= absorbedTo ? index - seam.eaten : Math.min(index, seam.at + seam.span - 1);
}

/** The merged window and the write's own as one contiguous change; `count` counts positions
 *  before the write, so the span converts back across what the write added or removed. */
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

/** A position the merge did not re-create keeps its block's id through both steps. Position 0
 *  always maps to the head, since a merge extends its head, even when it changes its kind. */
function composeFoldIdMap(
	change: StructuralChange,
	seam: SeamAbsorption,
	window: FoldWindow
): Record<number, number> {
	const idMap: Record<number, number> = {};
	for (let slot = 0; slot < window.newCount; slot++) {
		const index = window.lo + slot;
		if (index >= seam.at && index < seam.at + seam.span) continue;
		// Back through the merge: a position past the absorbed span sat `eaten` further down before it.
		const spliced = index < seam.at ? index : index + seam.eaten;
		const old = preChangeIndex(change, spliced, window);
		if (old === null) continue;
		const oldSlot = old - window.lo;
		if (oldSlot >= 0 && oldSlot < window.count) idMap[slot] = oldSlot;
	}
	if (idMap[0] === undefined) idMap[0] = 0;
	return idMap;
}

/** Where `spliced` (a post-change index) stood before the change, or null for a block the change
 *  created. */
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

/** The fragment parse's trailing blank run stays in the last block's raw at the body's tail and
 *  joins the follower's run elsewhere (`docs/design/syntax-tree.md` § Blank lines). */
function absorbFragmentPeel(
	body: BodyParent,
	followerIndex: number,
	peel: string,
	blocks: CstNode[],
	sharing: SharingState
): void {
	const follower = body.children[followerIndex];
	if (!follower) {
		blocks[blocks.length - 1].raw += peel;
		return;
	}
	// Blocks ending blank already hold the run's one separating line, so every line of the
	// follower's own becomes a blank block of the run instead of a second separator.
	const runSeparated = isBlankParagraph(blocks[blocks.length - 1]);
	if (peel === '' && !(runSeparated && follower.leadingTrivia !== '')) return;
	const lines = blankLinesOf(peel + follower.leadingTrivia);
	writeSeparator(body, followerIndex, lines.length > 1 || runSeparated ? '' : lines[0], sharing);
	const first = runSeparated ? 0 : 1;
	for (let i = first; i < lines.length; i++) {
		const trivia = !runSeparated && i === 1 ? lines[0] : '';
		blocks.push({ kind: 'paragraph', leadingTrivia: trivia, raw: lines[i] });
	}
}

/** A blank run split back into the lines it is made of, each keeping its own ending. */
const blankLinesOf = (run: string): string[] => run.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** The tail line that became a block, reported inside the caller's one contiguous window. */
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
	// A delete that took the tail vacated the position the new block lands in, so the two are
	// one window.
	if (change.op === 'delete' && change.at === before) {
		return { op: 'replace', at: change.at, count: change.count, newCount: grown };
	}
	// The new block landed past a window that does not reach the tail, so no single contiguous
	// span describes both; the parallel id arrays would drift either way this widened it.
	devWarn('tree-ops', 'a tail suffix materialized outside the reported window');
	return change;
}

/** Give the block at `index` a blank line where one separates anything; the line reuses the
 *  ending of the block above, which is the document's. */
function mintSeparator(body: BodyParent, index: number, sharing: SharingState): void {
	const { children } = body;
	if (index <= bodyStartIndex(body)) return;
	if (isBlankParagraph(children[index - 1])) return;
	writeSeparator(body, index, ownTrailingLineEnding(children[index - 1].raw), sharing);
}

/** A container's reserved title child is not a body block, so the body starts past it. */
function bodyStartIndex(body: BodyParent): number {
	const { owner } = body;
	return owner && tryGetBlockKindDescriptor(owner.kind)?.reservedChrome ? 1 : 0;
}

/** The owning container's declared body wrap; the document has none. */
function bodyWrapOf(body: BodyParent): ContainerBodyWrap | undefined {
	return body.owner && tryGetBlockKindDescriptor(body.owner.kind)?.bodyWrap;
}

/** Every write to a body changes bytes the owner's child spans describe, so the spans are dropped
 *  and the next rebuild re-derives them. */
function retireChildSpans(body: BodyParent): void {
	if (body.owner) dropChildSpans(body.owner);
}

/** The parser keeps the blank line after a fenced container's opener in `innerPrefix`, so a
 *  separator freed at the body head moves there, or the reload takes the head's own line. */
function absorbWrapPrefix(body: BodyParent, bodyStart: number, index: number, freed: string): void {
	const slots = body.owner;
	if (!slots || (slots.innerPrefix ?? '') !== '') return;
	if (!bodyWrapOf(body)?.afterOpenerLine) return;
	const head = body.children[bodyStart];
	if (!head || head.leadingTrivia !== '') return;
	if (index !== bodyStart && !isBlankParagraph(head)) return;
	writeWrapSlot(body, 'innerPrefix', ownTrailingLineEnding(freed));
}

// ── Delete ──

/** Remove the node at `blockIndex`, leaving its successor separated once and no more. A whole
 *  document reads as its own body. */
export function deleteNode(
	parent: BodyParentArg,
	blockIndex: number,
	grammar: GrammarView,
	sharing: SharingState,
	tracked?: TrackedPosition
): StructuralChange {
	const body = asBody(parent);
	const { children } = body;
	if (blockIndex < 0 || blockIndex >= children.length) return { op: 'noop' };

	const deleted = children[blockIndex];
	const successor = children[blockIndex + 1];
	// The successor inherits the deleted separator only when it has none of its own:
	// concatenating both leaves behind a blank line the delete should have taken.
	if (successor && successor.leadingTrivia === '' && deleted.leadingTrivia !== '') {
		writeSeparator(body, blockIndex + 1, deleted.leadingTrivia, sharing);
	}

	retireChildSpans(body);
	children.splice(blockIndex, 1);
	clearRedundantSeparator(body, blockIndex, sharing);
	// Both of the survivor's edges: the delete puts it beside a new follower, and a merge that
	// rewrote its bytes can equally have stopped it interrupting the block above.
	const survivor = Math.max(blockIndex - 1, 0);
	return absorbWindowSeams(
		body,
		survivor,
		blockIndex - survivor,
		blockIndex,
		{ op: 'delete', at: blockIndex, count: 1 },
		grammar,
		sharing,
		tracked
	).change;
}
