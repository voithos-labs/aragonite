/**
 * Delimiter runs (`*` `_` `~`) and CommonMark §6.2 phase 2 matching: a faithful port of
 * commonmark.js 0.31.2 processEmphasis (openers_bottom, odd-match on original run lengths,
 * closer re-use). The reference's two linked lists are overlays here, not pointers on the nodes.
 * commonmark.js is (c) 2014 John MacFarlane, BSD-2-Clause; see THIRD-PARTY-NOTICES.md.
 */

import type { InlineNode } from '../../nodes';
import { assertInvariant } from '../../../assert';
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

// Flanking neighbors are read as full code points: a UTF-16 unit read would classify an
// astral neighbor as a lone surrogate, while the spec defines the classes over code points.
function codePointBefore(raw: string, pos: number): string {
	const unit = raw.charCodeAt(pos - 1);
	if (unit >= 0xdc00 && unit <= 0xdfff && pos >= 2) {
		const high = raw.charCodeAt(pos - 2);
		if (high >= 0xd800 && high <= 0xdbff) return raw.slice(pos - 2, pos);
	}
	return raw[pos - 1];
}

/**
 * CommonMark §6.2 flanking over code points. Neighbors are read from raw unclamped: context
 * outside [start, end) still counts, as the spec's source-text reading implies.
 */
function classifyDelimiterRun(
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

	// cmark-gfm delimits strikethrough in tilde runs of length 1 or 2; a run of 3+ never
	// participates. The mixed-length non-pairing rule lives at the match, in processEmphasis.
	if (char === '~' && length > 2) {
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

/** Matches delimiters at stack index >= floor, then consumes the stack back down to `floor`. */
export function processEmphasis(ctx: ScanContext, floor: number): void {
	const { delimiters } = ctx;
	const top = delimiters.length;
	if (top === floor) return;
	const bottom = floor - 1; // sentinel index standing in for the reference's stack_bottom

	const win = openNodeWindow(ctx, delimiters[floor].node);
	const slotOf = mapDelimiterSlots(win, delimiters, floor, top);
	if (slotOf === null) {
		// Warn rather than throw: the state is unreachable today, and a false positive must not
		// take a real editor's block to the fallback. The runs left behind stay literal text.
		assertInvariant('emphasis-run-node-live', () => ({
			code: 'emphasis-run-node-missing',
			message:
				'a live delimiter run node was not in the working node list, so the emphasis pass ' +
				'for this range was dropped and its pairs will not form',
			detail: { floor, top, windowSize: win.slot.length }
		}));
		delimiters.length = floor;
		return;
	}

	// Linked overlay over stack indices [floor, top): retired delimiters unlink in O(1) without
	// splicing the shared stack (Bracket.delimiterFloor and openers_bottom index into it).
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

	// openers_bottom: per (char, closer canOpen, closer origLength % 3), the position below which
	// this closer class has proven no opener exists. Keeps repeated failed searches amortized O(1).
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
			if (
				candidate.char === closer.char &&
				candidate.canOpen &&
				!isOddMatch(candidate, closer) &&
				tildeLengthsAgree(candidate, closer)
			) {
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

		wrapMatch(win, ctx.raw, opener, closer, slotOf[oi], slotOf[ci]);

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

	closeNodeWindow(ctx, win);
	delimiters.length = floor;
}

const CHAR_BUCKET: Record<Delimiter['char'], number> = { '*': 0, _: 6, '~': 12 };

/** §6.2 multiple-of-3 rule, on ORIGINAL run lengths (commonmark.js `origdelims`). */
function isOddMatch(opener: Delimiter, closer: Delimiter): boolean {
	return (
		(closer.canOpen || opener.canClose) &&
		closer.origLength % 3 !== 0 &&
		(opener.origLength + closer.origLength) % 3 === 0
	);
}

/**
 * cmark-gfm pairs strikethrough runs only at equal length. A gate of its own: the multiple-of-3
 * rule misses the flanking-pure `~a~~` / `~~a~` shapes, and `*`/`_` carry no such rule.
 */
function tildeLengthsAgree(opener: Delimiter, closer: Delimiter): boolean {
	return closer.char !== '~' || opener.origLength === closer.origLength;
}

function wrapMatch(
	win: NodeWindow,
	raw: string,
	opener: Delimiter,
	closer: Delimiter,
	openerSlot: number,
	closerSlot: number
): void {
	const use = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
	const kind: InlineNode['kind'] =
		opener.char === '~' ? 'strikethrough' : use === 2 ? 'strong' : 'emphasis';

	// The NONE arm only bounds this walk. What rules out cycling the list closeNodeWindow walks
	// is the caller's contract (slots ascend with scan order, relinks skip forward), not this arm.
	const children: InlineNode[] = [];
	for (let i = win.next[openerSlot]; i !== closerSlot && i !== NONE; i = win.next[i]) {
		children.push(win.slot[i]);
	}
	win.next[openerSlot] = closerSlot;
	win.prev[closerSlot] = openerSlot;

	const wrapped: InlineNode = {
		kind,
		start: opener.node.end - use,
		end: closer.node.start + use,
		children
	};

	opener.length -= use;
	opener.node.end -= use;
	opener.node.text = raw.slice(opener.node.start, opener.node.end);
	closer.length -= use;
	closer.node.start += use;
	closer.node.text = raw.slice(closer.node.start, closer.node.end);

	insertNodeAfter(win, openerSlot, wrapped);
	if (opener.length === 0) unlinkNode(win, openerSlot);
	if (closer.length === 0) unlinkNode(win, closerSlot);
}

// ── Working-node window ─────────────────────────────────────────────────────

const NONE = -1;

/**
 * Doubly-linked view over the working nodes one pass owns, held beside them rather than on them
 * (an InlineNode is output, not scratch). The array it replaces made an all-pairs paragraph
 * quadratic. Link order, not array order, is node order.
 */
interface NodeWindow {
	slot: InlineNode[];
	prev: number[];
	next: number[];
	head: number;
	/** Where the window starts in ctx.nodes. */
	base: number;
}

/**
 * Nodes before `first` are out of every reachable match's range, so leaving them in place is
 * what keeps a bracket's recorded node position valid across the pass.
 */
function openNodeWindow(ctx: ScanContext, first: InlineNode): NodeWindow {
	let base = ctx.nodes.length - 1;
	while (base > 0 && ctx.nodes[base] !== first) base--;
	const slot = ctx.nodes.slice(base);
	const prev = new Array<number>(slot.length);
	const next = new Array<number>(slot.length);
	for (let i = 0; i < slot.length; i++) {
		prev[i] = i - 1; // slot 0 lands on NONE
		next[i] = i + 1 < slot.length ? i + 1 : NONE;
	}
	return { slot, prev, next, head: 0, base };
}

function closeNodeWindow(ctx: ScanContext, win: NodeWindow): void {
	const { nodes } = ctx;
	nodes.length = win.base;
	// One at a time: spreading a window this size hits V8's argument limit, and that
	// RangeError takes the block to the unhealable failed-block fallback.
	for (let i = win.head; i !== NONE; i = win.next[i]) nodes.push(win.slot[i]);
}

function unlinkNode(win: NodeWindow, i: number): void {
	const before = win.prev[i];
	const after = win.next[i];
	if (before === NONE) win.head = after;
	else win.next[before] = after;
	if (after !== NONE) win.prev[after] = before;
}

function insertNodeAfter(win: NodeWindow, at: number, node: InlineNode): void {
	const i = win.slot.length;
	win.slot.push(node);
	const after = win.next[at];
	win.prev[i] = at;
	win.next[i] = after;
	win.next[at] = i;
	if (after !== NONE) win.prev[after] = i;
}

/**
 * Delimiters and their run nodes are both in scan order, so one merge walk places them all.
 * Null when a run node is missing: the pass's precondition broke upstream, and the caller must
 * drop the pass rather than walk off a linked list that has no end.
 */
function mapDelimiterSlots(
	win: NodeWindow,
	delimiters: Delimiter[],
	floor: number,
	top: number
): number[] | null {
	const slotOf = new Array<number>(top);
	let s = 0;
	for (let d = floor; d < top; d++) {
		const node = delimiters[d].node;
		while (s < win.slot.length && win.slot[s] !== node) s++;
		if (s === win.slot.length) return null;
		slotOf[d] = s;
		s++;
	}
	return slotOf;
}
