/**
 * Delimiter runs (`*` `_` `~`) and CommonMark §6.2 phase 2 matching — a
 * faithful port of commonmark.js 0.31.2 processEmphasis (openers_bottom,
 * odd-match on original run lengths, closer re-use). Both lists the reference
 * keeps linked are linked here too, as overlays rather than pointers on the
 * nodes: per-pass delimiter liveness over stack indices, and the working nodes
 * a pass owns over a window into the flat list. Delimiters hold their text
 * node by identity, so neither overlay can leave one pointing at the wrong run.
 */

import type { InlineNode } from '../../nodes';
import { assertInvariant } from '../../../invariants/assert';
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

	// cmark-gfm delimits strikethrough in tilde runs of length 1 or 2; a run of
	// 3+ never participates and stays literal (the mixed-length non-pairing rule
	// lives at the match, in processEmphasis).
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

	const win = openNodeWindow(ctx, delimiters[floor].node);
	const slotOf = mapDelimiterSlots(win, delimiters, floor, top);
	if (slotOf === null) {
		// Dropping the pass costs every pair in it, and the runs left behind are
		// valid literal text, so the loss is invisible without a channel: warn
		// rather than throw, because the state is currently unreachable and a
		// false positive must not take a real editor's block to the fallback.
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
 * cmark-gfm pairs a strikethrough opener and closer only when their runs share a
 * length: a one-tilde run never closes a two-tilde run. (The multiple-of-3 rule
 * misses the flanking-pure `~a~~` / `~~a~` shapes, so this is a distinct gate;
 * `*`/`_` carry no such rule.)
 */
function tildeLengthsAgree(opener: Delimiter, closer: Delimiter): boolean {
	return closer.char !== '~' || opener.origLength === closer.origLength;
}

/**
 * Wrap the nodes between opener and closer: consume delimiters from the
 * facing ends of both runs, move the interior into a new parent whose range
 * includes the consumed markers, and drop run nodes that emptied.
 */
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

	// The NONE arm bounds this walk, nothing more: the relink below still runs,
	// and pointing it at a closer the opener cannot reach would cycle the list
	// that closeNodeWindow walks. What rules that out is the caller's contract —
	// slots ascend with scan order and every relink skips forward — not this arm.
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
 * Doubly-linked view over the working nodes one pass owns — the reference's
 * inline node list, scoped to the range a floor can reach and held beside the
 * nodes instead of on them (an InlineNode is output, not scratch). A match
 * detaches its interior by relinking two ends; the array it replaces paid a
 * scan to locate each run node and a tail move to splice, which is what made a
 * paragraph of nothing but pairs quadratic.
 */
interface NodeWindow {
	/** Slot storage. Link order, not array order, is node order. */
	slot: InlineNode[];
	prev: number[];
	next: number[];
	head: number;
	/** Where the window starts in ctx.nodes. */
	base: number;
}

/**
 * Take the window running from `first` to the end of the working list. Nodes
 * before `first` are out of every reachable match's range, so leaving them in
 * place is what keeps a bracket's recorded node position valid across a pass.
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

/** Write the window's link order back over the range it took. */
function closeNodeWindow(ctx: ScanContext, win: NodeWindow): void {
	const { nodes } = ctx;
	nodes.length = win.base;
	// One at a time: spreading a window this size dies on V8's argument limit,
	// and that RangeError takes the block to the unhealable failed-block fallback.
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
 * Each delimiter's slot in the window. Delimiters and the run nodes they hold
 * are both in scan order, so one merge walk places them all.
 *
 * Null when a run node is missing from the window, which means the pass's own
 * precondition — every live delimiter's node is still in the working list —
 * has been broken upstream. The caller then drops the pass entirely: the runs
 * stay the literal text they already are, where searching for a node that is
 * not there would walk off the end of a linked list that has no end.
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
