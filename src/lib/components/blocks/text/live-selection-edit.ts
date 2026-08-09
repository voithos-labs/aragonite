/**
 * What a native single-block selection edit writes in live mode. The range the user replaced can
 * span delimiter runs they never saw, and contenteditable takes those literally — the one
 * destructive path with no seam offsets of its own (§ 4.5). Re-expressed as a JOIN of what
 * survives on either side, it crosses the same seam every other one does, and the typed bytes
 * land where the two sides now meet.
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
