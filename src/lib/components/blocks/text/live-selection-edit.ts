/**
 * What a browser range edit writes in live mode. The range it targets can span delimiter runs the
 * user never saw, and contenteditable takes those literally, so the edit is re-expressed as a join
 * of what survives on either side, cleaned by the shared join rules (live-mode.md § 4.5). Every
 * editable prose block routes its `beforeinput` through {@link resolveLiveRangeEdit}, so no
 * gesture can reach the bytes by being missing from a list.
 */

import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { InlineResolverRef } from '../../../schema/inline-construct-policy';
import {
	snapToScalarBoundary,
	trailingLineEnding,
	trimTrailingLineEnding
} from '../../../core/lines';
import { cleanJoinedRaw } from '../../../tree-operations/node-ops';

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

/**
 * What a prose block does with a `beforeinput` in live mode. Null wherever the key does not belong
 * here, or there is nothing to clean: the browser's own edit is already right, and leaving it to
 * the browser keeps its grapheme and IME behavior.
 */
export function resolveLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	ambientPrefix = ''
): LiveRangeEdit | null {
	if (presentationMode !== 'live' || !rewritesTargetRange(e)) return null;
	const range = pendingEditRange(e, cursor);
	if (!range) return null;
	const insert = replacementText(e);
	if (range.start === range.end) return parkedCaretInsertion(node, cursor, range.start, insert);
	const edit = resolveSelectionEdit(
		node,
		range,
		insert ?? '',
		presentationMode,
		linkRef,
		ambientPrefix
	);
	if (!edit) return null;
	return insert === null
		? { kind: 'swallow' }
		: { kind: 'rewrite', range, raw: edit.raw, caret: edit.caret };
}

/**
 * A collapsed insertion has nothing to clean, but Chromium inserts at its own normalised reading
 * of the caret's pixel, back across a hidden run, while the DOM caret may sit where a commit left
 * it, past that run (just after a `)` was typed). A target behind the caret is that
 * normalisation, and the byte belongs where the caret is, the side keydown settled on. A target
 * at or past the caret is the browser placing the byte itself, which a split's reopened run
 * relies on: with the caret at its start, the byte goes inside.
 */
function parkedCaretInsertion(
	node: NodeView,
	cursor: LiveEditCursor,
	engineTarget: number,
	insert: string | null
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
		raw: display.slice(0, caret) + insert + display.slice(caret) + trailingLineEnding(node.raw),
		caret: caret + insert.length
	};
}

/**
 * The whole wrapper around {@link resolveLiveRangeEdit}: do nothing while a construct's shown
 * source has outrun the CST, resolve, `preventDefault` what belongs here, then write nothing or
 * hand the rewrite to the block's own `commit`. Shared so a new precondition reaches every block.
 */
export function applyLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	ambientPrefix: string,
	isRevealing: () => boolean,
	commit: (edit: LiveRangeRewrite) => void
): boolean {
	if (isRevealing()) return false;
	const edit = resolveLiveRangeEdit(e, node, cursor, presentationMode, linkRef, ambientPrefix);
	if (!edit) return false;
	e.preventDefault();
	if (edit.kind === 'rewrite') commit(edit);
	return true;
}

/**
 * The bytes replacing `[start, end)` with `typed`, or null when there was nothing to clean.
 * Exported for the callers that already hold a range of their own (the composition commit, the
 * gesture fuzzer) rather than an event to read one off.
 */
export function resolveSelectionEdit(
	node: NodeView,
	selection: { start: number; end: number },
	typed: string,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	ambientPrefix = ''
): SelectionEdit | null {
	// Both ends off any scalar interior before the slice: a half-pair here is unrecoverable
	// bytes, not a recoverable edit. Snapping the same direction cannot invert the range.
	const start = snapToScalarBoundary(node.raw, selection.start);
	const end = snapToScalarBoundary(node.raw, selection.end);
	if (start >= end) return null;
	const mergedRaw = node.raw.slice(0, start) + node.raw.slice(end);
	// `typed` goes in at the join rather than being spliced past it: the bytes the cleanup checks
	// have to be the bytes this returns, or the flanking it checked is not the one that ships.
	const joined = cleanJoinedRaw(
		{
			mergedRaw,
			seam: start,
			start: { node, offset: start },
			end: { node, offset: end },
			linkRef,
			typed,
			ambientPrefix
		},
		presentationMode
	);
	if (joined.raw === mergedRaw) return null;
	// The insert lands where the two sides now meet: the cleanup runs on the delete half, and the
	// commit's own reparse works out what the new bytes make of it.
	return {
		raw: joined.raw.slice(0, joined.seam) + typed + joined.raw.slice(joined.seam),
		caret: joined.seam + typed.length
	};
}

/** The rewrite of `[start, end)` to `typed` that a gesture the block consumed stores, where a
 *  delete passes the empty string. The cleaned bytes where the join rules have them, otherwise a
 *  plain splice of the displayed text with the caret past the insert. That fallback lives only
 *  here, so no caller can drift from it. */
export function replaceRangeRaw(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef,
	ambientPrefix: string
): SelectionEdit {
	const cleaned = resolveSelectionEdit(
		node,
		range,
		typed,
		presentationMode,
		linkRef,
		ambientPrefix
	);
	if (cleaned) return cleaned;
	const display = trimTrailingLineEnding(node.raw);
	return {
		raw:
			display.slice(0, range.start) +
			typed +
			display.slice(range.end) +
			trailingLineEnding(node.raw),
		caret: range.start + typed.length
	};
}

// ── Reading the event ────────────────────────────────────────────────────────

/**
 * The range the pending edit will rewrite. `getTargetRanges()` is the authority, since a word or
 * line delete at a collapsed caret reports the run rather than the caret; it is feature-detected
 * because jsdom implements no such method.
 */
function pendingEditRange(
	e: InputEvent,
	cursor: LiveEditCursor
): { start: number; end: number } | null {
	const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
	return targets.length > 0 ? cursor.rawRangeOf(targets[0]) : cursor.getRawSelection();
}

/**
 * The inputs that rewrite the range they target: every kind of delete (word, line, drag, cut,
 * forward, backward) plus the two that replace it with text. Paste and composition have their own
 * handling; composing is excluded by the input type's name and by the flag rather than by listing
 * the delete types today's browsers spell, since `composition-seat.ts` owns a composition from
 * start to finish and resolving it here too would write the block twice.
 */
function rewritesTargetRange(e: InputEvent): boolean {
	if (e.isComposing || /composition/i.test(e.inputType)) return false;
	return (
		e.inputType.startsWith('delete') ||
		e.inputType === 'insertText' ||
		e.inputType === 'insertReplacementText'
	);
}

/** What an input writes over its range, or null for a payload that cannot be read here: text
 *  carried on a `dataTransfer` would reach the commit's reparse without the paste transforms
 *  (G4.11), and consuming the key is safer than turning a replacement into a delete. */
function replacementText(e: InputEvent): string | null {
	return e.inputType.startsWith('delete') ? '' : e.data;
}
