/**
 * What a native single-block selection edit writes in live mode. The replaced range can span
 * delimiter runs the user never saw and contenteditable takes those literally, so the edit is
 * re-expressed as a JOIN of what survives on either side and crosses the shared seam
 * (live-mode.md § 4.5).
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

/** The native inputs that replace a live selection with something else — the one destructive
 *  family that reaches the bytes with no seam offsets of its own (live-mode.md § 4.5). */
export const SELECTION_REPLACING_INPUTS: ReadonlySet<string> = new Set([
	'insertText',
	'deleteContentBackward',
	'deleteContentForward'
]);

/** {@link resolveSelectionEdit} keyed off the input event, for the surfaces' beforeinput arms:
 *  null wherever the event is not a selection replacement or the seam has nothing to clean. */
export function resolveSelectionEditFromInput(
	e: InputEvent,
	node: NodeView,
	selection: { start: number; end: number },
	presentationMode: PresentationMode | undefined,
	linkRef: InlineResolverRef | undefined
): SelectionEdit | null {
	if (presentationMode !== 'live' || !SELECTION_REPLACING_INPUTS.has(e.inputType)) return null;
	const typed = e.inputType === 'insertText' ? (e.data ?? '') : '';
	return resolveSelectionEdit(node, selection, typed, presentationMode, linkRef);
}

/**
 * The bytes replacing `[start, end)` with `typed`, or null when the seam had nothing to clean —
 * there the engine's own edit is already right, and leaving it native keeps its grapheme and IME
 * behavior.
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
