/**
 * Replacing a range of one leaf, and joining two leaves, the way in-leaf edits and merges
 * write them: cut back to the painted text, off any surrogate pair, and in live mode with each
 * format run the join cuts through closed on the half that keeps it, typed text included, and a
 * reference whose text is its label spelled in full first (`docs/design/live-mode.md` § 4.5).
 */

import type { NodeView } from '../core/node-views';
import { makeBlockNode } from '../core/nodes';
import {
	constructContentRange,
	getContentRange,
	inlineDescendants,
	readInline,
	type ContentRange
} from '../core/inline';
import { readsInParts, shownOfSpan } from '../core/inline/live-edit/read-back';
import { resolvedInlineContent } from '../core/inline/inline-cache';
import type { ShownSpan } from '../core/inline/live-edit/shown-marks';
import { closesAndReopens } from '../core/inline/live-edit/close-reopen';
import {
	displayLength,
	ownTrailingLineEnding,
	snapToScalarBoundary,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import {
	cleanLiveJoinSeam,
	type CleanedJoin,
	type JoinEndpoint,
	type JoinSeam
} from '../core/inline/live-edit/live-join';
import type { StoredAs } from '../schema/stored-as';
import { normalizeOwnRaw } from './node-primitives';
import { cutBeforeSuffix, joinKeepingSuffix } from './structural-suffix';
import { spellReferenceLabels } from '../core/inline/link-source-bytes';

// ── Public API ───────────────────────────────────────────────────────────────

export interface LeafRangeEdit {
	/** The leaf's bytes after the edit, trailing line ending included. */
	raw: string;
	caret: number;
	/** The range replaced: a drawn one cut back to the painted text, and off any surrogate pair. */
	range: { start: number; end: number };
	/** Where the leaf's bytes past the range start in `raw`: after the typed text, and after any
	 *  closer or opener the join wrote there. */
	afterRange: number;
	/** Where an offset of the leaf's bytes before the edit lands in `raw`: one inside the range
	 *  lands at its start, the range's end at `afterRange`, one past it after the typed text. */
	mapOffset(offset: number): number;
}

/** `[start, end)` of `node` replaced by `typed`, the join cleaned against where `store` keeps it. */
export function replaceRangeInLeaf(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	store: StoredAs
): LeafRangeEdit {
	const edits = typed !== '' || range.start !== range.end;
	const spelled =
		edits && store.reading.hidesDelimitersAtCaret()
			? spellReferenceLabels(node, range, store.reading)
			: null;
	if (!spelled) return replaceInLeaf(node, range, typed, store);
	const moved = { start: spelled.map(range.start), end: spelled.map(range.end) };
	const edit = replaceInLeaf({ ...node, raw: spelled.raw }, moved, typed, store);
	return { ...edit, mapOffset: (offset) => edit.mapOffset(spelled.map(offset)) };
}

function replaceInLeaf(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	store: StoredAs
): LeafRangeEdit {
	const edit = spliceInLeaf(node, range, typed, store);
	if (!store.reading.hidesDelimitersAtCaret() || !carriesRuns(typed, store)) return edit;
	const content = getContentRange(node);
	const from = Math.max(content.start, Math.min(edit.range.start, content.end));
	const to = Math.max(from, Math.min(edit.range.end, content.end));
	const parts = partsAround(node.raw, content, from, to, typed, store);
	if (readsInParts(edit.raw, parts, store)) return edit;
	return landRuns(node, range, typed, store) ?? edit;
}

/** A selection typed or deleted over, or a delete span read as one. One over the block's whole
 *  text edits what it shows, inside a heading's `#` and a bold around it all (live-mode.md § 4.5). */
export function replaceDrawnRange(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	store: StoredAs
): LeafRangeEdit {
	const inside = wholeTextInside(node, range, store);
	if (!inside) return replaceRangeInLeaf(node, range, typed, store);
	// No block's text opens with whitespace, so the block's markers go with a deleted or
	// space-led whole text, and what is left is a paragraph holding what was typed.
	if (!/^\S/.test(typed)) return asWholeBlock(node, typed);
	return replaceRangeInLeaf(node, inside, typed, store);
}

/** The block's text inside its own markers and any run around all of it, where `range` covers that
 *  whole text in a reading that hides them; null for any other range. */
function wholeTextInside(
	node: NodeView,
	range: { start: number; end: number },
	store: StoredAs
): { start: number; end: number } | null {
	const { reading } = store;
	if (range.start >= range.end || !reading.hidesDelimitersAtCaret()) return null;
	const content = getContentRange(node);
	if (range.start > content.start || range.end < content.end || content.start >= content.end) {
		return null;
	}
	let { start, end } = content;
	// Pre-order is outermost first, so each run around the whole text steps in to the next.
	for (const inline of inlineDescendants(resolvedInlineContent(node, reading))) {
		const text = constructContentRange(inline);
		if (!text || !closesAndReopens(inline.kind)) continue;
		if (inline.start === start && inline.end === end) ({ start, end } = text);
	}
	return { start, end };
}

function asWholeBlock(node: NodeView, typed: string): LeafRangeEdit {
	const end = displayLength(node.raw);
	return {
		raw: typed + ownTrailingLineEnding(node.raw),
		caret: typed.length,
		range: { start: 0, end },
		afterRange: typed.length,
		mapOffset: (offset) => (offset >= end ? typed.length + offset - end : 0)
	};
}

/** {@link replaceRangeInLeaf} with `typed` written at the join as plain text. */
function spliceInLeaf(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	store: StoredAs
): LeafRangeEdit {
	// Only a drawn range can reach bytes the user never saw; a caret insert goes where the caret is.
	const painted =
		range.start !== range.end && store.reading.hidesDelimitersAtCaret()
			? { start: cutBeforeSuffix(node, range.start), end: cutBeforeSuffix(node, range.end) }
			: range;
	const start = snapToScalarBoundary(node.raw, painted.start);
	// An inverted range replaces nothing: the text goes in at its start.
	const end = Math.max(start, snapToScalarBoundary(node.raw, painted.end));
	// An offset of the leaf as the join reads it, the range taken out; the typed text goes in after.
	const merged = (offset: number) =>
		offset <= start ? offset : Math.max(start, offset - end + start);
	const afterTyped = (offset: number, to: number) => (offset >= end ? to + typed.length : to);
	if (start < end) {
		const join = cleanJoin({ node, offset: start }, { node, offset: end }, typed, store, same);
		if (join.cleaned) {
			const { raw, seam } = withTyped(join.joined, typed);
			const afterRange = join.joined.seamEnd + typed.length;
			return {
				raw,
				caret: seam + typed.length,
				range: { start, end },
				afterRange,
				mapOffset: (offset) =>
					offset === end ? afterRange : afterTyped(offset, join.joined.map(merged(offset)))
			};
		}
	}
	const display = trimTrailingLineEnding(node.raw);
	return {
		raw: display.slice(0, start) + typed + display.slice(end) + ownTrailingLineEnding(node.raw),
		caret: start + typed.length,
		range: { start, end },
		afterRange: start + typed.length,
		mapOffset: (offset) => afterTyped(offset, merged(offset))
	};
}

/** The bytes `[start, end)` of `node` carry out of it: the leaf cut down to the range by two in-leaf
 *  cuts, so a format run the range cuts through leaves closed at its edges, as the kept half does. */
export function bytesLeavingLeaf(
	node: NodeView,
	range: { start: number; end: number },
	store: StoredAs
): string {
	// Cut inside the text: the cleanup reads no side that starts in a heading's marker.
	const content = getContentRange(node);
	const tail = replaceRangeInLeaf(
		node,
		{ start: range.end, end: Math.max(range.end, content.end) },
		'',
		store
	);
	const head = replaceRangeInLeaf(
		{ ...node, raw: tail.raw },
		{ start: Math.min(range.start, content.start), end: tail.mapOffset(range.start) },
		'',
		store
	);
	return head.raw.slice(head.caret, head.mapOffset(tail.afterRange));
}

/** The bytes `head` up to its offset and `tail` from its offset make with `typed` between them,
 *  `seam` where `typed` starts. `tail`'s bytes take its kind's write rule, in `lineEnding`. */
export function joinLeaves(
	head: JoinEndpoint,
	tail: JoinEndpoint,
	typed: string,
	store: StoredAs,
	lineEnding: LineEnding
): Pick<CleanedJoin, 'raw' | 'seam'> {
	const writeTail = (bytes: string) => normalizeOwnRaw(tail.node, bytes, lineEnding);
	return withTyped(cleanJoin(head, tail, typed, store, writeTail).joined, typed);
}

/** `join.mergedRaw` with each format run the join cut through closed or reopened on the half that
 *  keeps it, where the reading hides delimiters. */
export function cleanJoinedRaw(join: JoinSeam): CleanedJoin {
	const literal = {
		raw: join.mergedRaw,
		seam: join.seam,
		seamEnd: join.seam,
		map: (offset: number) => offset
	};
	if (!join.store.reading.hidesDelimitersAtCaret()) return literal;
	return cleanLiveJoinSeam(join) ?? literal;
}

// ── Text that brings its own runs ────────────────────────────────────────────

/** Whether `text` holds a format run of its own, which a run it lands in must close around. */
function carriesRuns(text: string, store: StoredAs): boolean {
	// A run needs a delimiter on each side of its text, so a typed key never holds one.
	if (text.length < 3) return false;
	const { resolver, grammar } = store.reading;
	for (const node of inlineDescendants(readInline(text, 0, text.length, resolver, grammar))) {
		if (node.kind === 'text' || constructContentRange(node) === null) continue;
		if (closesAndReopens(node.kind)) return true;
	}
	return false;
}

/** `text` landed where `range` was: spliced in as written where that reads right, else joined in
 *  on both sides, so a run it lands in closes around it. Null where neither keeps every mark. */
function landRuns(
	node: NodeView,
	range: { start: number; end: number },
	text: string,
	store: StoredAs
): LeafRangeEdit | null {
	const cut = spliceInLeaf(node, range, '', store);
	const leaf = { ...node, raw: cut.raw };
	const at = cut.caret;
	const content = getContentRange(leaf);
	if (at < content.start || at > content.end) return null;
	const parts = partsAround(leaf.raw, content, at, at, text, store);
	const display = trimTrailingLineEnding(leaf.raw);
	const ending = ownTrailingLineEnding(leaf.raw);
	// Where the cut put an offset of `node`, before any text landed.
	const inCut = (offset: number) => cut.mapOffset(offset);
	const pastRange = (offset: number) => offset >= cut.range.end;

	const asWritten = display.slice(0, at) + text + display.slice(at) + ending;
	if (readsInParts(asWritten, parts, store)) {
		const shifted = (offset: number) => (offset >= at ? offset + text.length : offset);
		return {
			raw: asWritten,
			caret: at + text.length,
			range: cut.range,
			afterRange: shifted(cut.afterRange),
			mapOffset: (offset) => (pastRange(offset) ? shifted(inCut(offset)) : inCut(offset))
		};
	}

	const textLeaf = makeBlockNode({ kind: 'paragraph', leadingTrivia: '', raw: text + ending });
	const first = cleanJoinedRaw({
		mergedRaw: display.slice(0, at) + textLeaf.raw,
		seam: at,
		start: { node: leaf, offset: at },
		end: { node: textLeaf, offset: 0 },
		typed: '',
		store
	});
	const textEnd = first.map(at + text.length);
	const second = cleanJoinedRaw({
		mergedRaw: first.raw.slice(0, textEnd) + leaf.raw.slice(at),
		seam: textEnd,
		start: { node: { ...leaf, raw: first.raw }, offset: textEnd },
		end: { node: leaf, offset: at },
		typed: '',
		store
	});
	if (!readsInParts(second.raw, parts, store)) return null;
	const before = (offset: number) => second.map(first.map(Math.min(offset, at)));
	const after = (offset: number) =>
		offset === at ? second.seamEnd : second.map(textEnd + offset - at);
	return {
		raw: second.raw,
		caret: second.seam,
		range: cut.range,
		afterRange: after(cut.afterRange),
		mapOffset: (offset) => (pastRange(offset) ? after(inCut(offset)) : before(inCut(offset)))
	};
}

/** What `raw` shows before `from` and from `to`, and what `text` shows on its own. */
function partsAround(
	raw: string,
	content: ContentRange,
	from: number,
	to: number,
	text: string,
	{ reading }: StoredAs
): { before: ShownSpan; landed: ShownSpan; after: ShownSpan } {
	return {
		before: shownOfSpan(raw, content, content.start, from, reading),
		landed: shownOfSpan(text, { start: 0, end: text.length }, 0, text.length, reading),
		after: shownOfSpan(raw, content, to, content.end, reading)
	};
}

// ── The join ─────────────────────────────────────────────────────────────────

function cleanJoin(
	head: JoinEndpoint,
	tail: JoinEndpoint,
	typed: string,
	store: StoredAs,
	writeTail: (bytes: string) => string
): { joined: CleanedJoin; cleaned: boolean } {
	const merged = joinKeepingSuffix(head.node, head.offset, tail.node, tail.offset, writeTail);
	const joined = cleanJoinedRaw({
		mergedRaw: merged.raw,
		seam: merged.start,
		start: { node: head.node, offset: merged.start },
		end: { node: tail.node, offset: merged.end },
		typed,
		store
	});
	return { joined, cleaned: joined.raw !== merged.raw || joined.seam !== merged.start };
}

/** The tail of a range inside one leaf: that leaf's write rule runs once, when the bytes are
 *  installed. */
const same = (bytes: string): string => bytes;

const withTyped = (join: CleanedJoin, typed: string): Pick<CleanedJoin, 'raw' | 'seam'> => ({
	raw: join.raw.slice(0, join.seam) + typed + join.raw.slice(join.seam),
	seam: join.seam
});
