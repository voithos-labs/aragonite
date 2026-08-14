/**
 * What a native ranged edit writes in live mode. The range it targets can span delimiter runs the
 * user never saw and contenteditable takes those literally, so the edit is re-expressed as a JOIN
 * of what survives on either side and crosses the shared seam (live-mode.md § 4.5). Every editable
 * prose surface routes its `beforeinput` through {@link resolveLiveRangeEdit}, so a gesture family
 * cannot reach the bytes by being absent from a list.
 */

import type { NodeView } from '../../../core/node-views';
import type { PresentationMode } from '../../../presentation-mode';
import type { InlineResolverRef } from '../../../schema/inline-construct-policy';
import { cleanJoinedRaw } from '../../../tree-operations/node-ops';

export interface SelectionEdit {
	/** The block's whole bytes after the edit, trailing line ending included. */
	raw: string;
	caret: number;
}

/** The raw-offset readers a native ranged edit needs from its surface. */
export interface LiveEditCursor {
	rawRangeOf(range: AbstractRange): { start: number; end: number } | null;
	getRawSelection(): { start: number; end: number } | null;
}

/** Rewrite the block's bytes, or SWALLOW the press: an input this seam owns whose payload it may
 *  not read writes nothing, since the engine's version would splice the hidden runs literally. */
export type LiveRangeEdit =
	| { kind: 'rewrite'; range: { start: number; end: number }; raw: string; caret: number }
	| { kind: 'swallow' };

/**
 * What a prose surface does with a `beforeinput` in live mode. Null wherever the press is not this
 * seam's or the seam has nothing to clean — there the engine's own edit is already right, and
 * leaving it native keeps its grapheme and IME behavior.
 */
export function resolveLiveRangeEdit(
	e: InputEvent,
	node: NodeView,
	cursor: LiveEditCursor,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): LiveRangeEdit | null {
	if (presentationMode !== 'live' || !rewritesTargetRange(e)) return null;
	const range = pendingEditRange(e, cursor);
	if (!range) return null;
	const insert = replacementText(e);
	const edit = resolveSelectionEdit(node, range, insert ?? '', presentationMode, linkRef);
	if (!edit) return null;
	return insert === null
		? { kind: 'swallow' }
		: { kind: 'rewrite', range, raw: edit.raw, caret: edit.caret };
}

/**
 * The bytes replacing `[start, end)` with `typed`, or null when the seam had nothing to clean.
 * Exported for the callers that already hold a range of their own (the composition commit, the
 * gesture fuzzer) rather than an event to read one off.
 */
export function resolveSelectionEdit(
	node: NodeView,
	selection: { start: number; end: number },
	typed: string,
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): SelectionEdit | null {
	if (selection.start >= selection.end) return null;
	const mergedRaw = node.raw.slice(0, selection.start) + node.raw.slice(selection.end);
	const joined = cleanJoinedRaw(
		{
			mergedRaw,
			seam: selection.start,
			start: { node, offset: selection.start },
			end: { node, offset: selection.end },
			linkRef
		},
		presentationMode
	);
	if (joined.raw === mergedRaw) return null;
	// The insert lands where the two sides now meet — the paste-at-a-cleaned-seam rule: cleanup
	// runs in the DELETE half, and the commit's own re-parse settles what the new bytes make of it.
	return {
		raw: joined.raw.slice(0, joined.seam) + typed + joined.raw.slice(joined.seam),
		caret: joined.seam + typed.length
	};
}

// ── Reading the event ────────────────────────────────────────────────────────

/**
 * The range the pending edit will rewrite. `getTargetRanges()` is the authority — a word or line
 * delete at a COLLAPSED caret reports the run, not the caret — and is feature-detected because
 * jsdom implements no such method.
 */
function pendingEditRange(
	e: InputEvent,
	cursor: LiveEditCursor
): { start: number; end: number } | null {
	const targets = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
	return targets.length > 0 ? cursor.rawRangeOf(targets[0]) : cursor.getRawSelection();
}

/**
 * The inputs that rewrite the range they target: every delete family — word, line, drag, cut,
 * forward, backward — plus the two that replace it with text. Paste and composition carry seams of
 * their own; composing is excluded by the NAME and by the flag rather than by listing the two
 * delete types today's engines spell, since `composition-seat.ts` owns that window end to end and a
 * second resolution here writes the block twice.
 */
function rewritesTargetRange(e: InputEvent): boolean {
	if (e.isComposing || /composition/i.test(e.inputType)) return false;
	return (
		e.inputType.startsWith('delete') ||
		e.inputType === 'insertText' ||
		e.inputType === 'insertReplacementText'
	);
}

/** What an input writes over its range, or null for a payload this seam may not read: text riding
 *  a `dataTransfer` would reach the commit's re-parse without the paste transforms (G4.11), and a
 *  swallowed press is sounder than turning a replacement into a delete. */
function replacementText(e: InputEvent): string | null {
	return e.inputType.startsWith('delete') ? '' : e.data;
}
