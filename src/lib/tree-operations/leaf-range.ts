/**
 * Replacing a range of one leaf, and joining two leaves, the way every in-leaf edit and merge
 * writes them: cut back to the painted text, off any surrogate pair, and in live mode with the
 * delimiter runs the join strands dropped, typed text included (`docs/design/live-mode.md` § 4.5).
 */

import type { NodeView } from '../core/node-views';
import { snapToScalarBoundary, trailingLineEnding, trimTrailingLineEnding } from '../core/lines';
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
	/** The range replaced, once cut back to the painted text. */
	range: { start: number; end: number };
	/** Whether `raw` is the range spliced exactly as asked, which the browser's own edit writes
	 *  too, keeping its grapheme and IME handling. */
	matchesBrowserEdit: boolean;
}

/** `[start, end)` of `node` replaced by `typed`, the join cleaned against where `store` keeps it. */
export function replaceRangeInLeaf(
	node: NodeView,
	range: { start: number; end: number },
	typed: string,
	store: StoredAs
): LeafRangeEdit {
	const painted = store.reading.hidesDelimitersAtCaret()
		? { start: cutBeforeSuffix(node, range.start), end: cutBeforeSuffix(node, range.end) }
		: range;
	const start = snapToScalarBoundary(node.raw, painted.start);
	// An inverted range replaces nothing: the text goes in at its start.
	const end = Math.max(start, snapToScalarBoundary(node.raw, painted.end));
	if (start < end) {
		const join = cleanJoin({ node, offset: start }, { node, offset: end }, typed, store);
		if (join.cleaned) {
			const { raw, seam } = withTyped(join.joined, typed);
			return { raw, caret: seam + typed.length, range: { start, end }, matchesBrowserEdit: false };
		}
	}
	const display = trimTrailingLineEnding(node.raw);
	return {
		raw:
			display.slice(0, start) +
			typed +
			display.slice(end) +
			trailingLineEnding(node.raw, store.lineEnding),
		caret: start + typed.length,
		range: { start, end },
		matchesBrowserEdit: painted.end === range.end
	};
}

/** The bytes `head` up to its offset and `tail` from its offset make with `typed` between them,
 *  `seam` where `typed` starts. */
export function joinLeaves(
	head: JoinEndpoint,
	tail: JoinEndpoint,
	typed: string,
	store: StoredAs
): CleanedJoin {
	return withTyped(cleanJoin(head, tail, typed, store).joined, typed);
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
	store: StoredAs
): { joined: CleanedJoin; cleaned: boolean } {
	// A leaf's own write rule runs once, when the joined bytes are installed; only bytes from
	// another leaf still need theirs.
	const writeTail =
		tail.node === head.node
			? (bytes: string) => bytes
			: (bytes: string) => normalizeOwnRaw(tail.node, bytes, store.lineEnding);
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

const withTyped = (join: CleanedJoin, typed: string): CleanedJoin => ({
	raw: join.raw.slice(0, join.seam) + typed + join.raw.slice(join.seam),
	seam: join.seam
});
