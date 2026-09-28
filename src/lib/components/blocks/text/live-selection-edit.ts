/**
 * What a browser range edit writes in live mode. The range can span delimiter runs the user never
 * saw, which contenteditable would take literally, so the edit becomes a join of what survives on
 * either side, cleaned by the shared join rules (`docs/design/live-mode.md` § 4.5). Every prose
 * block routes its `beforeinput` through {@link resolveLiveRangeEdit}.
 */

import type { NodeView } from '../../../core/node-views';
import type { StoredAs } from '../../../schema/stored-as';
import {
	snapToScalarBoundary,
	trailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../../core/lines';
import { cleanJoinedRaw, replaceRangeInLeaf } from '../../../tree-operations/leaf-range';

export interface SelectionEdit {
	/** The block's whole bytes after the edit, trailing line ending included. */
	raw: string;
	caret: number;
}

/** The raw-offset lookups a browser range edit needs from the block. */
export interface LiveEditCursor {
	rawRangeOf(range: AbstractRange): { start: number; end: number } | null;
	getRawSelection(): { start: number; end: number } | null;
}

/** Rewrite the block's bytes, or consume the key and write nothing: an input handled here whose
 *  payload cannot be read writes nothing, since the browser would splice the hidden runs. */
export type LiveRangeEdit = LiveRangeRewrite | { kind: 'swallow' };

export interface LiveRangeRewrite {
	kind: 'rewrite';
	range: { start: number; end: number };
	raw: string;
	caret: number;
}

/** What a prose block does with a `beforeinput` in live mode. Null where there is nothing to clean,
 *  so the browser keeps its own edit and its grapheme and IME behavior. */
export function resolveLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	lineEnding: LineEnding,
	store: StoredAs
): LiveRangeEdit | null {
	if (!store.reading.hidesDelimitersAtCaret() || !rewritesTargetRange(e)) return null;
	const target = pendingEditRange(e, cursor);
	if (!target) return null;
	const insert = replacementText(e);
	if (target.start === target.end) {
		return parkedCaretInsertion(node, cursor, target.start, insert, lineEnding);
	}
	const edit = replaceRangeInLeaf(node, target, insert ?? '', store);
	if (edit.matchesBrowserEdit) return null;
	return insert === null
		? { kind: 'swallow' }
		: { kind: 'rewrite', range: edit.range, raw: edit.raw, caret: edit.caret };
}

/** A collapsed insertion Chromium aimed back across a hidden run (just after a typed `)`) goes where
 *  the caret is. A target at or past the caret stands, since a split's reopened run relies on it. */
function parkedCaretInsertion(
	node: NodeView,
	cursor: LiveEditCursor,
	engineTarget: number,
	insert: string | null,
	lineEnding: LineEnding
): LiveRangeEdit | null {
	if (!insert) return null;
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
	const caret = cursor.rawRangeOf(selection.getRangeAt(0))?.start ?? null;
	if (caret === null || engineTarget >= caret) return null;
	const display = trimTrailingLineEnding(node.raw);
	return {
		kind: 'rewrite',
		range: { start: caret, end: caret },
		raw:
			display.slice(0, caret) +
			insert +
			display.slice(caret) +
			trailingLineEnding(node.raw, lineEnding),
		caret: caret + insert.length
	};
}

/** The wrapper every block runs around {@link resolveLiveRangeEdit}, shared so a new precondition
 *  reaches every block. Does nothing while a shown source has outrun the CST. */
export function applyLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	lineEnding: LineEnding,
	store: StoredAs,
	isRevealing: () => boolean,
	commit: (edit: LiveRangeRewrite) => void
): boolean {
	if (isRevealing()) return false;
	const edit = resolveLiveRangeEdit(e, node, cursor, lineEnding, store);
	if (!edit) return false;
	e.preventDefault();
	if (edit.kind === 'rewrite') commit(edit);
	return true;
}

/** The bytes replacing `[start, end)` with `typed`, or null when there was nothing to clean, for a
 *  caller holding a range rather than an event (the composition commit, the gesture fuzzer). */
export function resolveSelectionEdit(
	node: NodeView,
	selection: { start: number; end: number },
	typed: string,
	store: StoredAs
): SelectionEdit | null {
	// Both ends off any scalar interior before the slice: a half-pair here is unrecoverable
	// bytes, not a recoverable edit. Snapping the same direction cannot invert the range.
	const start = snapToScalarBoundary(node.raw, selection.start);
	const end = snapToScalarBoundary(node.raw, selection.end);
	if (start >= end) return null;
	const mergedRaw = node.raw.slice(0, start) + node.raw.slice(end);
	// `typed` goes in at the join rather than being spliced past it: the bytes the cleanup checks
	// have to be the bytes this returns, or the flanking it checked is not the one that ships.
	const joined = cleanJoinedRaw({
		mergedRaw,
		seam: start,
		start: { node, offset: start },
		end: { node, offset: end },
		typed,
		store
	});
	if (joined.raw === mergedRaw) return null;
	// The insert lands where the two sides now meet: the cleanup runs on the delete half, and the
	// commit's own reparse works out what the new bytes make of it.
	return {
		raw: joined.raw.slice(0, joined.seam) + typed + joined.raw.slice(joined.seam),
		caret: joined.seam + typed.length
	};
}

// ── Reading the event ────────────────────────────────────────────────────────

/** The range the pending edit will rewrite, from `getTargetRanges()`, since a word delete reports
 *  the run rather than the caret. Feature-detected because jsdom has no such method. */
function pendingEditRange(
	e: InputEvent,
	cursor: LiveEditCursor
): { start: number; end: number } | null {
	const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
	return targets.length > 0 ? cursor.rawRangeOf(targets[0]) : cursor.getRawSelection();
}

/** The inputs that rewrite the range they target. Composition is excluded by name and flag, since
 *  `composition-seat.ts` handles it start to finish and a second write here would double it. */
function rewritesTargetRange(e: InputEvent): boolean {
	if (e.isComposing || /composition/i.test(e.inputType)) return false;
	return (
		e.inputType.startsWith('delete') ||
		e.inputType === 'insertText' ||
		e.inputType === 'insertReplacementText'
	);
}

/** What an input writes over its range, or null for `dataTransfer` text, which would skip the paste
 *  transforms (G4.11); consuming the key beats turning a replacement into a delete. */
function replacementText(e: InputEvent): string | null {
	return e.inputType.startsWith('delete') ? '' : e.data;
}
