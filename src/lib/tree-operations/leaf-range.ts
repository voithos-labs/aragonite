/**
 * Replacing a range of one leaf, and joining two leaves, the way in-leaf edits and merges
 * write them: cut back to the painted text, off any surrogate pair, and in live mode with the
 * delimiter runs the join strands dropped, typed text included (`docs/design/live-mode.md` § 4.5).
 */

import type { NodeView } from '../core/node-views';
import {
	ownTrailingLineEnding,
	snapToScalarBoundary,
	trimTrailingLineEnding,
	type LineEnding
} from '../core/lines';
import {
	getLiveJoinSeamCleaner,
	type CleanedJoin,
	type JoinEndpoint,
	type JoinSeam
} from '../schema/inline-construct-policy';
import type { StoredAs } from '../schema/stored-as';
import { normalizeOwnRaw } from './node-primitives';
import { cutBeforeSuffix, joinKeepingSuffix } from './structural-suffix';

// ── Public API ───────────────────────────────────────────────────────────────

export interface LeafRangeEdit {
	/** The leaf's bytes after the edit, trailing line ending included. */
	raw: string;
	caret: number;
	/** The range replaced: a drawn one cut back to the painted text, and off any surrogate pair. */
	range: { start: number; end: number };
	/** Whether `raw` is the range asked for spliced with nothing moved or cleaned, the edit the
	 *  browser makes itself, grapheme and IME handling included. */
	matchesBrowserEdit: boolean;
}

/** `[start, end)` of `node` replaced by `typed`, the join cleaned against where `store` keeps it. */
export function replaceRangeInLeaf(
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
	if (start < end) {
		const join = cleanJoin({ node, offset: start }, { node, offset: end }, typed, store, same);
		if (join.cleaned) {
			const { raw, seam } = withTyped(join.joined, typed);
			return { raw, caret: seam + typed.length, range: { start, end }, matchesBrowserEdit: false };
		}
	}
	const display = trimTrailingLineEnding(node.raw);
	return {
		raw: display.slice(0, start) + typed + display.slice(end) + ownTrailingLineEnding(node.raw),
		caret: start + typed.length,
		range: { start, end },
		matchesBrowserEdit: start === range.start && end === range.end
	};
}

/** The bytes `head` up to its offset and `tail` from its offset make with `typed` between them,
 *  `seam` where `typed` starts. `tail`'s bytes take its kind's write rule, in `lineEnding`. */
export function joinLeaves(
	head: JoinEndpoint,
	tail: JoinEndpoint,
	typed: string,
	store: StoredAs,
	lineEnding: LineEnding
): CleanedJoin {
	const writeTail = (bytes: string) => normalizeOwnRaw(tail.node, bytes, lineEnding);
	return withTyped(cleanJoin(head, tail, typed, store, writeTail).joined, typed);
}

/** `join.mergedRaw` minus the delimiter runs the join left unpaired, where the reading hides
 *  delimiters. */
export function cleanJoinedRaw(join: JoinSeam): CleanedJoin {
	const literal = { raw: join.mergedRaw, seam: join.seam };
	if (!join.store.reading.hidesDelimitersAtCaret()) return literal;
	return getLiveJoinSeamCleaner()?.(join) ?? literal;
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
	return { joined, cleaned: joined.raw !== merged.raw };
}

/** The tail of a range inside one leaf: that leaf's write rule runs once, when the bytes are
 *  installed. */
const same = (bytes: string): string => bytes;

const withTyped = (join: CleanedJoin, typed: string): CleanedJoin => ({
	raw: join.raw.slice(0, join.seam) + typed + join.raw.slice(join.seam),
	seam: join.seam
});
