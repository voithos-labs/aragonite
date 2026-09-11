/**
 * The separator settle every splice owes its neighbourhood (syntax-tree.md § Blank lines), the
 * seam absorb behind it (editor.md § 8), and the delete primitive built on both. `sharing` owns
 * every in-place write (G1.9); the retire census in `lint/separator-write-doors.test.ts` names
 * every door here.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph, parse, type ContainerBodyWrap } from '../core/parser';
import { trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { devWarn } from '../dev-warn';
import { assignChildIdsDeep } from '../block-id';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { dropChildSpans } from '../schema/child-spans';
import { assertInvariant } from '../assert';
import { checkStructuralDescriptor } from '../invariants/structural-descriptor';
import type { SharingState } from './sharing';
import { ensureUnsharedChild } from './unshare';
import { spliceChildren } from './children';
import { spliceMany } from './splice-many';
import { applyStructuralChangeToIdsRefs, type StructuralChange } from './structural-change';
import {
	ensureEditableContainers,
	type BodyParentArg,
	type NodeParent,
	type SeparatorParent
} from './node-primitives';

// ── Separators ──

/**
 * Settle the separator at `index`: nothing needs one at the body head or below a blank block,
 * where the parser would read the extra line as one more empty paragraph.
 */
export function clearRedundantSeparator(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
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
 * A blank block IS a blank line, so it and its follower share ONE separator (G2.13). The
 * follower's stands, so a later fill of this slot still finds the follower separated.
 */
export function dropDoubledSeparator(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
	const node = parent.children?.[index];
	if (!node || node.leadingTrivia === '' || !isBlankParagraph(node)) return;
	if ((parent.children?.[index + 1]?.leadingTrivia ?? '') === '') return;
	const owned = sharing ? ensureUnsharedChild(parent as NodeParent, index, sharing) : node;
	owned.leadingTrivia = '';
}

/**
 * The separator a block takes back when it stops being blank: its own blank line was what stood
 * between it and a non-blank predecessor. Call at the fill.
 */
export function restoreSeparatorOnFill(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
	const node = parent.children?.[index];
	if (!node || node.leadingTrivia !== '' || isBlankParagraph(node)) return;
	mintSeparator(parent, index, sharing);
}

/**
 * The separator the block BELOW a consumed blank line takes back: the same mint minus the
 * blank-self guard, declined where its own follower already holds one (G2.13).
 */
export function restoreSeparatorAfterBlank(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
	const children = parent.children;
	const node = children?.[index];
	if (!children || !node || node.leadingTrivia !== '') return;
	if (isBlankParagraph(node) && (children[index + 1]?.leadingTrivia ?? '') !== '') return;
	mintSeparator(parent, index, sharing);
}

/**
 * The settle a block turning INTO a blank line owes: the run it joins carries exactly ONE
 * separating line across every block in it AND its follower. The line already standing is
 * kept; a mint lands at the run's head, the only slot one may take.
 */
export function settleSeparatorOnBlank(
	parent: SeparatorParent,
	index: number,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
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
	// A run of two or more that IS the whole body sits against both chrome lines: the reload
	// peels a line into each slot before it materializes a block, so it owes BOTH.
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
	// peel no longer engages beside the opener's, so the run gives the extra line back.
	const loneBlankBody = start === bodyStart && end === bodyEnd && start === end;
	if (slots && loneBlankBody && slots.innerSuffix && (slots.innerPrefix || standing.length > 0)) {
		slots.innerSuffix = '';
	}
	const headUnderWrap =
		!!slots && wrap?.afterOpenerLine === true && start === bodyStart && end < bodyEnd;
	// A line already standing IS the opener's peel on reload, so taking one as well would add a
	// line; a two-peel body's count comes out of the slots, not out of the run.
	const takesOpenerPeel = twoPeelBody || (headUnderWrap && standing.length === 0);
	if (slots && takesOpenerPeel && !slots.innerPrefix) {
		slots.innerPrefix = trailingLineEnding(children[start].raw);
	}
	// Under the wrap the run keeps exactly one peel line, in `innerPrefix` or still standing;
	// elsewhere a run with no line above it separates from nothing and materializes in full.
	let wanted: number;
	if (twoPeelBody) wanted = 0;
	else if (headUnderWrap) wanted = slots?.innerPrefix ? 0 : 1;
	else wanted = start > 0 || wrap?.afterOpenerLine ? 1 : 0;
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
 * The give-back twin of {@link settleSeparatorOnBlank}'s closer peel: a tail that stops being
 * blank owes the borrowed `innerSuffix` line back, or the wrap emits a line nobody typed.
 */
export function releaseWrapPeel(parent: SeparatorParent, index: number): void {
	retireChildSpans(parent);
	const children = parent.children;
	const slots = wrapSlotsOf(parent);
	if (!children || children.length === 0 || !slots?.innerSuffix) return;
	if (!bodyWrapOf(parent)?.beforeCloserLine) return;
	if (index < children.length - 1) return;
	if (isBlankParagraph(children[children.length - 1])) return;
	slots.innerSuffix = '';
}

/**
 * The parse folds the document's one trailing blank line into `suffix` only while the tail block
 * is non-blank; once the tail turns blank the reload reads that line as its own empty paragraph,
 * so the settle materializes it. Document-level slot only. Returns the blocks appended.
 */
function materializeTailSuffix(parent: SeparatorParent, sharing?: SharingState): number {
	retireChildSpans(parent);
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
 * The settle every splice owes its neighbourhood, then the seam question over the window.
 * `removed` is the pre-splice span, the only place was-blank survives a splice; `tracked` rides
 * the folds for a door landing a caret in the spliced bytes.
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
	// Unconditional, and the funnel's only home for it: a delete window at the tail probes no
	// slot, and the question is about the parent's LAST block.
	materializeTailSuffix(parent, sharing);
	const widened = widenForTailMint(change, beforeMint, parent.children.length);
	// The seam question is part of SETTLING, not a rule each door carries, so door N+1 inherits
	// it. A byte-shaped write reporting `noop` splices no window and is asked nothing.
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

/** Whoever takes the slot inherits its line, having none of its own ({@link deleteNode}'s rule). */
function handDownVacatedSeparator(
	parent: SeparatorParent,
	at: number,
	vacated: string,
	sharing?: SharingState
): void {
	retireChildSpans(parent);
	const heir = parent.children?.[at];
	if (vacated === '' || !heir || heir.leadingTrivia !== '') return;
	const owned = sharing ? ensureUnsharedChild(parent as NodeParent, at, sharing) : heir;
	owned.leadingTrivia = vacated;
}

/**
 * The commit ceremony's settle door: derive the spliced window from the change and settle it
 * against `before`, the pre-mutate children. Nodes surviving inside the window are not removals,
 * so a coarse descriptor over an in-place write settles as one.
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
	spliceChildren(parent as CstNode, at, removeCount, replacement);
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
 * What a seam settle absorbed: post-splice window position and size, and the net blocks eaten.
 * `span + eaten` is the pre-absorb slot count, which is what a change descriptor reports.
 */
interface SeamAbsorption {
	at: number;
	span: number;
	eaten: number;
	spliced: boolean;
}

/** A byte position the folds carry with them, written in place since each fold re-tiles the bytes. */
export interface TrackedPosition {
	index: number;
	offset: number;
}

/**
 * A splice can leave neighbours whose adjacent bytes re-read as fewer blocks on reload. Absorb
 * while the window's own bytes parse to fewer blocks, which is the reload's reading; a blank run
 * is transparent to a container's continuation, so the window anchors at the nearest non-blank
 * block above the seam, never below `floor`, and cascades.
 */
export function absorbSeamReading(
	parent: NodeParent,
	seamLeft: number,
	floor: number,
	sharing?: SharingState,
	tracked?: TrackedPosition,
	headProbe?: number,
	onBeforeSplice?: () => void
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
		const reparsed = parse(joinedWindowBytes(window, window.length), { scope: 'fragment' });
		const blocks = reparsed.children;
		if (blocks.length === 0 || blocks.length >= window.length) break;
		// A fold may PROMOTE the head past what its bytes carry alone (a paragraph under the
		// setext underline below it), so what must survive is the head's own reading, not its kind.
		if (blocks[0].kind !== window[0].kind && !readsAsItselfAlone(window[0])) break;
		onBeforeSplice?.();
		absorbFragmentPeel(parent, at + window.length, reparsed.suffix, blocks, sharing);
		blocks[0].leadingTrivia = window[0].leadingTrivia;
		for (const block of blocks) {
			ensureEditableContainers(block);
			if (sharing) sharing.stamp(block);
			assignChildIdsDeep(block);
		}
		if (tracked) retrackThroughFold(tracked, at, window, blocks);
		spliceMany(children, at, window.length, blocks);
		eaten += window.length - blocks.length;
		span = blocks.length;
		spliced = true;
	}
	return { at, span, eaten, spliced };
}

/**
 * Whether a block's own bytes read back as that block. A structured container's children fail
 * this by construction (one list item's bytes read as a LIST), which is how a scope whose
 * children a document parse does NOT reproduce declines the seam question.
 */
function readsAsItselfAlone(node: CstNode): boolean {
	const alone = parse(node.raw, { scope: 'fragment' }).children;
	return alone.length === 1 && alone[0].kind === node.kind;
}

/**
 * Decline-only pre-parse for a window whose LAST member is the block that changed: join the
 * others with only that block's first line. Block parsing is a left-to-right line scan, so a
 * block opening here opens in the full join too; a pass falls through to the real parse.
 */
function declinesOnHeadLine(window: readonly CstNode[], member: number): boolean {
	if (member <= 0 || member !== window.length - 1) return false;
	const raw = window[member].raw;
	const nl = raw.indexOf('\n');
	const joined =
		joinedWindowBytes(window, member) +
		window[member].leadingTrivia +
		(nl < 0 ? raw : raw.slice(0, nl + 1));
	return parse(joined, { scope: 'fragment' }).children.length >= window.length;
}

/** How a fold reads a window: the head's raw, then each of the next `count - 1` members'
 *  leading trivia and raw. */
function joinedWindowBytes(window: readonly CstNode[], count: number): string {
	let joined = window[0].raw;
	for (let i = 1; i < count; i++) joined += window[i].leadingTrivia + window[i].raw;
	return joined;
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

/**
 * Map a post-edit caret offset (in the committed text) to the parsed block it falls in, as a
 * local display offset. An offset inside inter-block trivia lands at the next block's start;
 * past-the-end clamps to the last.
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

/** What a splice settled: its change widened by every fold, and where a tracked index landed. */
export interface SettledSplice {
	change: StructuralChange;
	landing: number;
}

/**
 * The seam question at every join the splice at `at` disturbed, its window's two edges and the
 * joins inside it, since a move can invalidate a join that was already correct. Each fold
 * cascades downward. `headProbe` names the one block whose bytes changed, letting each ask
 * decline on its first line alone; dropped once anything folds, since its index has moved.
 */
export function absorbWindowSeams(
	parent: NodeParent,
	at: number,
	added: number,
	landing: number,
	change: StructuralChange,
	sharing?: SharingState,
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
			parent,
			seamLeft,
			0,
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
 * mapping wherever the walk has none, since a fold EXTENDS its head, kind promotion included.
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
	return ownerNodeOf(parent);
}

/** The container node these children belong to, where the caller answered for one. */
function ownerNodeOf(parent: SeparatorParent): CstNode | undefined {
	return parent.owner ?? ('raw' in parent ? (parent as CstNode) : undefined);
}

/**
 * Every settle door rewrites bytes the owner's child spans describe while leaving the children's
 * shape alone, so the spans retire at the doors and the next rebuild re-derives them.
 */
function retireChildSpans(parent: SeparatorParent): void {
	const owner = ownerNodeOf(parent);
	if (owner) dropChildSpans(owner);
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
 * A chrome-wrapped container's parse peels the blank line against its opener into `innerPrefix`,
 * so a separator freed above the body head is that line: hand it over, or the peel eats the head.
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
 * owner's wrap slots; the successor's trivia is the op's only in-place write.
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
