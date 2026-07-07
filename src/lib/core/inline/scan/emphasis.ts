/**
 * Delimiter runs (`*` `_` `~`) and CommonMark §6.2 phase 2 matching — a
 * faithful port of commonmark.js 0.31.2 processEmphasis (openers_bottom,
 * odd-match on original run lengths, closer re-use) onto the flat working
 * node list. Delimiters hold their text node by identity so wrap splices
 * cannot invalidate them; per-pass liveness lives in a linked overlay over
 * stack indices, mirroring the reference's delimiter list surgery.
 */

import type { InlineNode } from '../../nodes';
import { appendNode, type Delimiter, type ScanContext } from './scan-state';

// ── Flanking classification (§6.2 phase 1) ──────────────────────────────────

/** Unicode punctuation (ASCII punctuation + general category P). */
function isPunct(ch: string): boolean {
	if (!ch) return false;
	const code = ch.codePointAt(0)!;
	if (
		(code >= 0x21 && code <= 0x2f) ||
		(code >= 0x3a && code <= 0x40) ||
		(code >= 0x5b && code <= 0x60) ||
		(code >= 0x7b && code <= 0x7e)
	) {
		return true;
	}
	return /^\p{P}$/u.test(ch);
}

function isWhitespace(ch: string): boolean {
	if (!ch) return true; // string boundary counts as whitespace
	return /\s/.test(ch);
}

// Flanking neighbors are read as full code points: a UTF-16 unit read would
// classify an astral neighbor as a lone surrogate ("other"), while the spec
// defines the character classes over code points.
function codePointBefore(raw: string, pos: number): string {
	const unit = raw.charCodeAt(pos - 1);
	if (unit >= 0xdc00 && unit <= 0xdfff && pos >= 2) {
		const high = raw.charCodeAt(pos - 2);
		if (high >= 0xd800 && high <= 0xdbff) return raw.slice(pos - 2, pos);
	}
	return raw[pos - 1];
}

/**
 * CommonMark §6.2 flanking over code points (astral neighbors classify by
 * category, not surrogate halves). Neighbors are read from raw unclamped:
 * context outside [start, end) still counts, as the spec's source-text
 * reading implies.
 */
export function classifyDelimiterRun(
	raw: string,
	runStart: number,
	runEnd: number,
	kind: '*' | '_' | '~'
): { canOpen: boolean; canClose: boolean } {
	const charBefore = runStart > 0 ? codePointBefore(raw, runStart) : '';
	const charAfter = runEnd < raw.length ? String.fromCodePoint(raw.codePointAt(runEnd)!) : '';

	const followedByWhitespace = isWhitespace(charAfter);
	const followedByPunct = isPunct(charAfter);
	const precededByWhitespace = isWhitespace(charBefore);
	const precededByPunct = isPunct(charBefore);

	const leftFlanking =
		!followedByWhitespace && (!followedByPunct || precededByWhitespace || precededByPunct);
	const rightFlanking =
		!precededByWhitespace && (!precededByPunct || followedByWhitespace || followedByPunct);

	if (kind === '*' || kind === '~') {
		return { canOpen: leftFlanking, canClose: rightFlanking };
	}
	// `_` has extra restrictions to avoid intra-word emphasis.
	const canOpen = leftFlanking && (!rightFlanking || precededByPunct);
	const canClose = rightFlanking && (!leftFlanking || followedByPunct);
	return { canOpen, canClose };
}

// ── Scan-time handler ───────────────────────────────────────────────────────

export function handleDelimiter(ctx: ScanContext): void {
	const { raw, pos, end } = ctx;
	const char = raw[pos] as Delimiter['char'];
	let runEnd = pos + 1;
	while (runEnd < end && raw[runEnd] === char) runEnd++;
	const length = runEnd - pos;

	// GFM strikethrough delimits only in runs of exactly 2; runs that can
	// neither open nor close never participate. Both stay pending text.
	if (char === '~' && length !== 2) {
		ctx.pos = runEnd;
		return;
	}
	const { canOpen, canClose } = classifyDelimiterRun(raw, pos, runEnd, char);
	if (!canOpen && !canClose) {
		ctx.pos = runEnd;
		return;
	}

	const node: InlineNode = { kind: 'text', start: pos, end: runEnd, text: raw.slice(pos, runEnd) };
	appendNode(ctx, node);
	ctx.delimiters.push({ node, char, length, origLength: length, canOpen, canClose });
}

// ── §6.2 phase 2 ────────────────────────────────────────────────────────────

/**
 * Match openers to closers among delimiters at stack index >= floor, wrapping
 * each match's interior nodes into an emphasis/strong/strikethrough node whose
 * range includes both markers. Consumes the stack back down to `floor`.
 */
export function processEmphasis(ctx: ScanContext, floor: number): void {
	const { delimiters } = ctx;
	const top = delimiters.length;
	if (top === floor) return;
	const bottom = floor - 1; // sentinel index standing in for the reference's stack_bottom

	// Linked overlay over stack indices [floor, top): retired delimiters
	// unlink in O(1) without splicing the shared stack (Bracket.delimiterFloor
	// and openers_bottom hold positions into it).
	const prev = new Array<number>(top);
	const next = new Array<number>(top);
	for (let i = floor; i < top; i++) {
		prev[i] = i - 1;
		next[i] = i + 1;
	}
	const unlink = (i: number): void => {
		if (prev[i] > bottom) next[prev[i]] = next[i];
		if (next[i] < top) prev[next[i]] = prev[i];
	};

	// openers_bottom: per (char, closer canOpen, closer origLength % 3), the
	// position below which this closer class has already proven no opener
	// exists — keeps repeated failed searches amortized O(1).
	const openersBottom = new Array<number>(18).fill(bottom);

	let ci = floor;
	while (ci < top) {
		const closer = delimiters[ci];
		if (!closer.canClose) {
			ci = next[ci];
			continue;
		}

		const bucket = CHAR_BUCKET[closer.char] + (closer.canOpen ? 3 : 0) + (closer.origLength % 3);
		const stopAt = openersBottom[bucket];
		let opener: Delimiter | null = null;
		let oi = prev[ci];
		while (oi > bottom && oi !== stopAt) {
			const candidate = delimiters[oi];
			if (candidate.char === closer.char && candidate.canOpen && !isOddMatch(candidate, closer)) {
				opener = candidate;
				break;
			}
			oi = prev[oi];
		}

		if (opener === null) {
			openersBottom[bucket] = prev[ci];
			const after = next[ci];
			if (!closer.canOpen) unlink(ci);
			ci = after;
			continue;
		}

		wrapMatch(ctx, opener, closer);

		// Delimiters between the pair moved inside the wrap: retire them.
		next[oi] = ci;
		prev[ci] = oi;
		if (opener.length === 0) unlink(oi);
		if (closer.length === 0) {
			const after = next[ci];
			unlink(ci);
			ci = after;
		}
		// A closer with remaining length retries against earlier openers.
	}

	delimiters.length = floor;
}

const CHAR_BUCKET: Record<Delimiter['char'], number> = { '*': 0, _: 6, '~': 12 };

/**
 * Multiple-of-3 rule on ORIGINAL run lengths (commonmark.js `origdelims`):
 * when either run could serve both roles, a combined length divisible by 3
 * blocks the match unless the closer's own length already is.
 */
function isOddMatch(opener: Delimiter, closer: Delimiter): boolean {
	return (
		(closer.canOpen || opener.canClose) &&
		closer.origLength % 3 !== 0 &&
		(opener.origLength + closer.origLength) % 3 === 0
	);
}

/**
 * Wrap the nodes between opener and closer: consume delimiters from the
 * facing ends of both runs, splice the interior into a new parent whose range
 * includes the consumed markers, and drop run nodes that emptied.
 */
function wrapMatch(ctx: ScanContext, opener: Delimiter, closer: Delimiter): void {
	const { nodes, raw } = ctx;
	const use = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
	const kind: InlineNode['kind'] =
		opener.char === '~' ? 'strikethrough' : use === 2 ? 'strong' : 'emphasis';

	const openerPos = nodes.indexOf(opener.node);
	const closerPos = nodes.indexOf(closer.node, openerPos + 1);
	const wrapped: InlineNode = {
		kind,
		start: opener.node.end - use,
		end: closer.node.start + use,
		children: nodes.slice(openerPos + 1, closerPos)
	};

	opener.length -= use;
	opener.node.end -= use;
	opener.node.text = raw.slice(opener.node.start, opener.node.end);
	closer.length -= use;
	closer.node.start += use;
	closer.node.text = raw.slice(closer.node.start, closer.node.end);

	const replacement: InlineNode[] = [];
	if (opener.length > 0) replacement.push(opener.node);
	replacement.push(wrapped);
	if (closer.length > 0) replacement.push(closer.node);
	nodes.splice(openerPos, closerPos - openerPos + 1, ...replacement);
}
