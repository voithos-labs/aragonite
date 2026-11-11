/**
 * The live-mode split rewrite (live-mode.md § 4.4 close-and-reopen): Enter inside a construct
 * closes it before the cut and reopens it after, so neither half strands a run the user never
 * saw. Bytes stay candidates until the parser agrees; null leaves `splitNode`'s literal cut.
 */

import {
	constructContentRange,
	constructHoldsOffset,
	constructKinds,
	getContentRange,
	inlineDescendants,
	isProseKind,
	readInline
} from '../index';
import { CONTENT_VISIBILITY, paintsOnlyChrome, renderedText } from '../visibility';
import { readBack, shownOf } from './read-back';
import type { Reading } from '../../../schema/reading';
import type { StoredAs } from '../../../schema/stored-as';
import type { AnyInlineKind, InlineNode } from '../../nodes';
import type { NodeView } from '../../node-views';
import { isBlankText, readsAsBlankLine, trimTrailingLineEnding } from '../../lines';
import {
	chordSpelling,
	closeBefore,
	closesAndReopens,
	reopenAfter,
	type CutConstruct
} from './close-reopen';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

/** Where each half of a split is stored: the first in the block's own slot, the second where the
 *  split puts it (the next slot, or a new list item's first). */
export interface SplitStores {
	first: StoredAs;
	second: StoredAs;
	/** Text the second half lands behind on its line (a paste's last line): the half reads there
	 *  as it reads alone, in its chord's marker where its own can't open after that text. */
	behind?: string;
}

/** The two halves with the cut's constructs closed and reopened, or null to keep the literal cut. */
export function rebalanceLiveSplit(
	node: NodeView,
	offset: number,
	firstRaw: string,
	secondRaw: string,
	stores: SplitStores
): { firstRaw: string; secondRaw: string } | null {
	const { reading } = stores.first;
	const read = readSplitBytes(node, offset, firstRaw, secondRaw);
	if (read === null) return null;
	const inlines = readInline(
		read.raw,
		read.contentStart,
		read.contentEnd,
		reading.resolver,
		reading.grammar
	);
	// Markers standing over nothing are all on screen (live-mode.md § 4.1), so closing and
	// reopening them would move delimiters the user is looking at: the literal cut stands.
	if (paintsOnlyChrome(inlines, read.raw, { grammar: reading.grammar })) return null;
	const moved = wholeConstructEdge(inlines, offset);
	const at = moved ?? offset;
	const bytes = moved === null ? read : { ...read, cut: moved };
	const chain = splittableChainAt(inlines, at);
	// An empty chain with the cut where the caller put it is a cut no construct touches, and the
	// literal halves are already right; a cut that moved is a rewrite in its own right.
	if (chain === null || (chain.length === 0 && moved === null)) return null;
	const seam = seamParts(bytes, chain, at);
	const candidates = [
		assemble(bytes, seam),
		assembleSpaceOutside(bytes, seam),
		assembleDroppingTerminalTrivia(bytes, seam),
		stores.behind ? assembleInChordMarkers(bytes, seam, chain) : null
	];
	for (const candidate of candidates) {
		// The dropped bytes are the check's business, not the caller's: what the caller gets back
		// is the two halves, whatever the candidate had to declare to earn them.
		if (candidate !== null && parsesBack(bytes, seam, candidate, stores)) {
			return { firstRaw: candidate.firstRaw, secondRaw: candidate.secondRaw };
		}
	}
	return null;
}

/** Where a cut at `offset` of `node` lands: the nearer edge of a construct that splits whole and
 *  holds it, `offset` itself anywhere else. */
export function cutOutsideWhole(node: NodeView, offset: number, reading: Reading): number {
	if (!isProseKind(node.kind)) return offset;
	const { start, end } = getContentRange(node);
	const inlines = readInline(node.raw, start, end, reading.resolver, reading.grammar);
	return wholeConstructEdge(inlines, offset) ?? offset;
}

// ── What the caller already decided ──────────────────────────────────────────

/** The original bytes, plus what each half carries beyond the content it took: the padding line
 *  ending, or a structural suffix the split has already moved (a setext underline). */
interface SplitBytes {
	raw: string;
	contentStart: number;
	contentEnd: number;
	/** Where the second half's content begins in `raw`, past a line ending the cut consumed. */
	cut: number;
	firstResidue: string;
	secondResidue: string;
}

/**
 * Read the caller's two halves back against the original, so a cut this rewrite did not make (a
 * container body-write rule, a suffix move, a consumed line ending) shows up as a failed match.
 */
function readSplitBytes(
	node: NodeView,
	offset: number,
	firstRaw: string,
	secondRaw: string
): SplitBytes | null {
	if (!isProseKind(node.kind)) return null;
	const raw = node.raw;
	const { start, end } = getContentRange(node);
	if (offset <= start || offset >= end) return null;
	if (!firstRaw.startsWith(raw.slice(0, offset))) return null;
	for (let cut = offset; cut <= offset + 2 && cut < end; cut++) {
		const body = raw.slice(cut, end);
		if (!secondRaw.startsWith(body)) continue;
		return {
			raw,
			contentStart: start,
			contentEnd: end,
			cut,
			firstResidue: firstRaw.slice(offset),
			secondResidue: secondRaw.slice(body.length)
		};
	}
	return null;
}

// ── The chain ────────────────────────────────────────────────────────────────

/** Where a cut inside a construct split whole (a URL, an escape) moves to: the edge the caret was
 *  nearer, so the construct goes whole to one half (`docs/design/live-mode.md` § 4.4). */
function wholeConstructEdge(inlines: readonly InlineNode[], offset: number): number | null {
	let found: number | null = null;
	for (const node of inlineDescendants(inlines)) {
		const takesWhole = getInlineConstructPolicy(node.kind)?.splitBehavior === 'whole';
		if (takesWhole && offset > node.start && offset < node.end) {
			found = offset - node.start <= node.end - offset ? node.start : node.end;
		}
	}
	return found;
}

/** Every construct holding `offset`, outermost first, or null when one cannot be cut open, since
 *  cutting the constructs inside it would strand its pair. Exported for the depth test. */
export function splittableChainAt(
	inlines: readonly InlineNode[],
	offset: number
): CutConstruct[] | null {
	const chain: CutConstruct[] = [];
	const holds = (node: InlineNode): boolean => constructHoldsOffset(node, offset);
	for (const node of inlineDescendants(inlines, holds)) {
		if (!holds(node)) continue;
		const content = constructContentRange(node);
		if (!content) return null;
		if (!closesAndReopens(node.kind)) return null;
		chain.push({
			kind: node.kind,
			start: node.start,
			end: node.end,
			contentStart: content.start,
			contentEnd: content.end
		});
	}
	return chain;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface SeamParts {
	/** Bytes before the cut, the block's own marker prefix included. */
	head: string;
	closers: string;
	openers: string;
	/** Bytes after the cut, up to the block's content end. */
	tail: string;
	closed: AnyInlineKind[];
	reopened: AnyInlineKind[];
}

interface RebalancedHalves {
	firstRaw: string;
	secondRaw: string;
	/** Bytes this candidate left out, which the conservation check then expects to be missing. */
	droppedTail?: string;
}

/** A side with no content takes the whole construct, since live mode never writes a pair
 *  enclosing nothing. */
function seamParts(bytes: SplitBytes, chain: readonly CutConstruct[], offset: number): SeamParts {
	const left = closeBefore(bytes.raw, chain, offset);
	const right = reopenAfter(bytes.raw, chain, bytes.cut);
	return {
		head: bytes.raw.slice(0, left.end),
		closers: left.closers,
		openers: right.openers,
		tail: bytes.raw.slice(right.start, bytes.contentEnd),
		closed: left.closed.map((link) => link.kind),
		reopened: right.reopened.map((link) => link.kind)
	};
}

const assemble = (bytes: SplitBytes, seam: SeamParts): RebalancedHalves => ({
	firstRaw: seam.head + seam.closers + bytes.firstResidue,
	secondRaw: seam.openers + seam.tail + bytes.secondResidue
});

/** The same cut with a boundary space handed to the plain text beside it: a run cannot open or close
 *  against whitespace, and a space's formatting is invisible anyway. */
function assembleSpaceOutside(bytes: SplitBytes, seam: SeamParts): RebalancedHalves | null {
	const trailing = seam.closers !== '' && seam.head.endsWith(' ');
	const leading = seam.openers !== '' && seam.tail.startsWith(' ');
	if (!trailing && !leading) return null;
	return {
		firstRaw:
			(trailing ? seam.head.slice(0, -1) + seam.closers + ' ' : seam.head + seam.closers) +
			bytes.firstResidue,
		secondRaw:
			(leading ? ' ' + seam.openers + seam.tail.slice(1) : seam.openers + seam.tail) +
			bytes.secondResidue
	};
}

/** The cut with a whitespace-only tail dropped: trailing whitespace draws nothing, and live mode
 *  may drop what it never showed (`docs/design/live-mode.md` § 4.5). */
function assembleDroppingTerminalTrivia(
	bytes: SplitBytes,
	seam: SeamParts
): RebalancedHalves | null {
	if (seam.openers !== '' || seam.tail === '' || !isBlankText(seam.tail)) return null;
	return {
		firstRaw: seam.head + seam.closers + bytes.firstResidue,
		secondRaw: bytes.secondResidue,
		droppedTail: seam.tail
	};
}

/** The cut with the reopened runs in their chords' markers, which open after a word character
 *  where `__` can't: the first half keeps the bytes it had. */
function assembleInChordMarkers(
	bytes: SplitBytes,
	seam: SeamParts,
	chain: readonly CutConstruct[]
): RebalancedHalves | null {
	const right = reopenAfter(bytes.raw, chain, bytes.cut);
	let [openers, tail, at] = ['', '', right.start];
	// Innermost first, the order the closers stand in.
	for (const link of right.reopened) {
		const { opener, closer } = chordSpelling(bytes.raw, link);
		openers = opener + openers;
		tail += bytes.raw.slice(at, link.contentEnd) + closer;
		at = link.end;
	}
	if (openers === seam.openers) return null;
	return {
		firstRaw: seam.head + seam.closers + bytes.firstResidue,
		secondRaw: openers + tail + bytes.raw.slice(at, bytes.contentEnd) + bytes.secondResidue
	};
}

// ── Verification ─────────────────────────────────────────────────────────────

interface HalfRead {
	visible: string;
	kinds: Set<AnyInlineKind>;
}

/** A candidate answers every question below, each half read where it is stored, or it is not
 *  written. Exported for the test, which reaches it with candidates no producer here builds. */
export function parsesBack(
	bytes: SplitBytes,
	seam: SeamParts,
	candidate: RebalancedHalves,
	stores: SplitStores
): boolean {
	const { reading } = stores.first;
	const first = proseHalf(candidate.firstRaw, stores.first);
	const second = proseHalf(candidate.secondRaw, stores.second);
	if (first === null || second === null) return false;
	// Each half must be a block a reparse keeps, judged by its bytes: a code span showing one space
	// is still a code span.
	if (readsAsBlankLine(candidate.firstRaw) || readsAsBlankLine(candidate.secondRaw)) return false;
	if (!seam.closed.every((kind) => first.kinds.has(kind))) return false;
	if (!seam.reopened.every((kind) => second.kinds.has(kind))) return false;
	if (stores.behind && !readsAloneBehind(stores.behind, candidate.secondRaw, reading)) return false;
	// The render check below counts characters while CSS collapses a trailing run to nothing, so
	// the "the screen never showed it" rule is tested here rather than taken on trust.
	if (candidate.droppedTail !== undefined && !isBlankText(candidate.droppedTail)) return false;
	const whole = renderedText(
		readInline(bytes.raw, bytes.contentStart, bytes.contentEnd, reading.resolver, reading.grammar),
		bytes.raw,
		CONTENT_VISIBILITY,
		{ grammar: reading.grammar }
	);
	if (!whole.startsWith(first.visible)) return false;
	// A split may consume only the line ending the cut landed on and a dropped tail, which the
	// candidate names rather than the check inferring it.
	const rest = whole.slice(first.visible.length);
	const tail = second.visible + (candidate.droppedTail ?? '');
	return rest === tail || rest === '\n' + tail || rest === '\r\n' + tail;
}

/** Whether `half` shows behind `text` on one line what each shows alone. */
function readsAloneBehind(text: string, half: string, reading: Reading): boolean {
	const shown = (raw: string) =>
		renderedText(
			readInline(raw, 0, raw.length, reading.resolver, reading.grammar),
			raw,
			CONTENT_VISIBILITY,
			{ grammar: reading.grammar }
		);
	const line = trimTrailingLineEnding(half);
	return shown(text + line) === shown(text) + shown(line);
}

/** A half read where `store` keeps it: exactly one prose block, or null. */
function proseHalf(raw: string, store: StoredAs): HalfRead | null {
	const read = readBack(raw, store);
	if (read === null) return null;
	return { visible: shownOf(read, store), kinds: constructKinds(read.inlines) };
}
