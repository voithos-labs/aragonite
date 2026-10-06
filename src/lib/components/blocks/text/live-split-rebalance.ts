/**
 * The live-mode split rewrite (live-mode.md § 4.4 close-and-reopen): Enter inside a construct
 * closes it before the cut and reopens it after, so neither half strands a run the user never
 * saw. Bytes stay candidates until the parser agrees; null leaves `splitNode`'s literal cut.
 */

import {
	constructContentRange,
	constructKinds,
	getContentRange,
	inlineDescendants,
	isProseKind,
	readInline
} from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText
} from '../../../core/inline/visibility';
import { readBack, shownOf } from '../../../core/inline/live-edit/read-back';
import type { StoredAs } from '../../../schema/stored-as';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { isBlankText } from '../../../core/lines';
import {
	getInlineConstructPolicy,
	type LiveSplitRebalancer,
	type SplitStores
} from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const rebalanceLiveSplit: LiveSplitRebalancer = (
	node,
	offset,
	firstRaw,
	secondRaw,
	stores
) => {
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
		assembleDroppingTerminalTrivia(bytes, seam)
	];
	for (const candidate of candidates) {
		// The dropped bytes are the check's business, not the caller's: what the caller gets back
		// is the two halves, whatever the candidate had to declare to earn them.
		if (candidate !== null && parsesBack(bytes, seam, candidate, stores)) {
			return { firstRaw: candidate.firstRaw, secondRaw: candidate.secondRaw };
		}
	}
	return null;
};

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

export interface ChainLink {
	kind: AnyInlineKind;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

/** Where a cut inside a childless never-extend construct (a URL, an escape) moves to: the edge the
 *  caret was nearer, so the construct goes whole to one half (`docs/design/live-mode.md` § 4.4). */
function wholeConstructEdge(inlines: readonly InlineNode[], offset: number): number | null {
	let found: number | null = null;
	for (const node of inlineDescendants(inlines)) {
		const childless = node.kind !== 'text' && constructContentRange(node) === null;
		const takesWhole =
			childless && getInlineConstructPolicy(node.kind)?.edgeAffinity === 'never-extend';
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
): ChainLink[] | null {
	const chain: ChainLink[] = [];
	const holds = (node: InlineNode): boolean => holdsOffset(node, offset);
	for (const node of inlineDescendants(inlines, holds)) {
		if (!holds(node)) continue;
		const content = constructContentRange(node);
		if (!content) return null;
		if (getInlineConstructPolicy(node.kind)?.splitBehavior !== 'close-and-reopen') return null;
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

/** Whether a cut at `offset` lands in this construct: one with children includes its content
 *  bounds; one without counts only its strict interior, since its edges are ordinary cut points. */
function holdsOffset(node: InlineNode, offset: number): boolean {
	if (node.kind === 'text') return false;
	const content = constructContentRange(node);
	return content
		? offset >= content.start && offset <= content.end
		: offset > node.start && offset < node.end;
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

/** Innermost first, so the halves nest as the original did. A side with no content takes the whole
 *  construct, since live mode never writes a pair enclosing nothing. */
function seamParts(bytes: SplitBytes, chain: readonly ChainLink[], offset: number): SeamParts {
	let leftEnd = offset;
	let rightStart = bytes.cut;
	let closers = '';
	let openers = '';
	const closed: AnyInlineKind[] = [];
	const reopened: AnyInlineKind[] = [];
	for (const link of [...chain].reverse()) {
		if (leftEnd === link.contentStart) leftEnd = link.start;
		else {
			closers += bytes.raw.slice(link.contentEnd, link.end);
			closed.push(link.kind);
		}
		if (rightStart === link.contentEnd) rightStart = link.end;
		else {
			openers = bytes.raw.slice(link.start, link.contentStart) + openers;
			reopened.push(link.kind);
		}
	}
	return {
		head: bytes.raw.slice(0, leftEnd),
		closers,
		openers,
		tail: bytes.raw.slice(rightStart, bytes.contentEnd),
		closed,
		reopened
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
	// Each half must be a block a reparse keeps. Empty is one; whitespace-only is not, since the
	// document reads those bytes as a blank line and the pair comes back a different shape.
	if (readsAsBlankLine(first.visible) || readsAsBlankLine(second.visible)) return false;
	if (!seam.closed.every((kind) => first.kinds.has(kind))) return false;
	if (!seam.reopened.every((kind) => second.kinds.has(kind))) return false;
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

const readsAsBlankLine = (visible: string): boolean => visible !== '' && isBlankText(visible);

/** A half read where `store` keeps it: exactly one prose block, or null. */
function proseHalf(raw: string, store: StoredAs): HalfRead | null {
	const read = readBack(raw, store);
	if (read === null) return null;
	return { visible: shownOf(read, store), kinds: constructKinds(read.inlines) };
}
