/**
 * The live-mode split rewrite (live-mode.md § 4.4 close-and-reopen): Enter inside a construct
 * closes it before the cut and reopens it after, so neither half strands a run the reader never
 * saw. Bytes stay candidates until the parser agrees; null leaves `splitNode`'s byte-literal cut.
 */

import {
	constructContentRange,
	constructKinds,
	getContentRange,
	inlineDescendants,
	isProseKind,
	parseInline
} from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText
} from '../../../core/inline/visibility';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import {
	getInlineConstructPolicy,
	type LiveSplitRebalancer
} from '../../../schema/inline-construct-policy';
import { soleProseReparse } from './screen-diff';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const rebalanceLiveSplit: LiveSplitRebalancer = (
	node,
	offset,
	firstRaw,
	secondRaw,
	linkRef
) => {
	const read = readSplitBytes(node, offset, firstRaw, secondRaw);
	if (read === null) return null;
	const resolver = linkRef?.current;
	const inlines = parseInline(read.raw, read.contentStart, read.contentEnd, resolver);
	// Chrome standing over nothing is all on screen (live-mode.md § 4.1), so closing and reopening
	// it moves delimiters the reader is looking at: the byte-literal cut stands.
	if (paintsOnlyChrome(inlines, read.raw)) return null;
	const moved = wholeConstructEdge(inlines, offset);
	const at = moved ?? offset;
	const bytes = moved === null ? read : { ...read, cut: moved };
	const chain = splittableChainAt(inlines, at);
	// An empty chain with the cut where the caller put it is a cut no construct touches, and the
	// byte-literal halves are already right; a MOVED cut is a rewrite in its own right.
	if (chain === null || (chain.length === 0 && moved === null)) return null;
	const seam = seamParts(bytes, chain, at);
	const candidates = [
		assemble(bytes, seam),
		assembleSpaceOutside(bytes, seam),
		assembleDroppingTerminalTrivia(bytes, seam)
	];
	for (const candidate of candidates) {
		// The dropped bytes are the verification's business, not the caller's: what it gets back
		// is the two halves, whatever the candidate had to state to earn them.
		if (candidate !== null && parsesBack(bytes, seam, candidate, resolver)) {
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
	/** Where the second half's content begins in `raw` — past a line ending the cut consumed. */
	cut: number;
	firstResidue: string;
	secondResidue: string;
}

/**
 * Read the caller's two halves back against the original, so a cut this rewrite did not make (a
 * container body-write rule, a suffix move, a consumed line ending) surfaces as a failed anchor.
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

interface ChainLink {
	kind: AnyInlineKind;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

/**
 * The edge a cut moves to rather than landing inside a childless never-extend construct: two
 * halves of a URL are not two URLs, and half an escape is a literal backslash, so the whole
 * construct goes to the half the caret was nearer (live-mode.md § 4.4). Null where the cut lands
 * in no such construct. Innermost wins, as everywhere else.
 */
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

/**
 * Every construct holding `offset`, outermost first — or null when one of them declines. A kind
 * with no policy row, one whose split behavior is plain and one whose content bounds are unknown
 * cannot be cut open, and cutting the constructs inside one would strand its pair.
 */
function splittableChainAt(inlines: readonly InlineNode[], offset: number): ChainLink[] | null {
	const chain: ChainLink[] = [];
	const visit = (nodes: readonly InlineNode[]): boolean => {
		for (const node of nodes) {
			if (node.kind === 'text') continue;
			const content = constructContentRange(node);
			// A construct with children is content-inclusive so its edges reach the chain (the
			// handover cases); a childless one is strict-interior, its edges being ordinary seams.
			const holds = content
				? offset >= content.start && offset <= content.end
				: offset > node.start && offset < node.end;
			if (!holds) continue;
			if (!content) return false;
			if (getInlineConstructPolicy(node.kind)?.splitBehavior !== 'close-and-reopen') return false;
			chain.push({
				kind: node.kind,
				start: node.start,
				end: node.end,
				contentStart: content.start,
				contentEnd: content.end
			});
			if (node.children && !visit(node.children)) return false;
		}
		return true;
	};
	return visit(inlines) ? chain : null;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface SeamParts {
	/** Bytes before the seam, the block's own marker prefix included. */
	head: string;
	closers: string;
	openers: string;
	/** Bytes after the seam, up to the block's content end. */
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

/**
 * Innermost first, so a closer written before its enclosing one nests the halves as the original
 * did. A side with no content takes the whole construct: a pair enclosing nothing is residue live
 * may never write.
 */
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

/**
 * The same seam with a boundary space handed to the plain text beside it. Markdown opens and
 * closes a run against a word, never whitespace, so a space left inside kills the construct; a
 * space's formatting is invisible, so moving it is the reading that parses and looks unchanged.
 */
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

/**
 * The seam with a whitespace-only tail dropped rather than handed to either half. A block's
 * TERMINAL whitespace is a hard break with no following line, so it paints nothing, and
 * live-mode.md § 4.5 licenses live to drop what it never showed.
 */
function assembleDroppingTerminalTrivia(
	bytes: SplitBytes,
	seam: SeamParts
): RebalancedHalves | null {
	if (seam.openers !== '' || seam.tail === '' || seam.tail.trim() !== '') return null;
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

/**
 * A candidate answers every question below or it is not written. Exported for the verification
 * test, which has to reach it with a candidate no producer here would build.
 */
export function parsesBack(
	bytes: SplitBytes,
	seam: SeamParts,
	candidate: RebalancedHalves,
	resolver: LinkReferenceResolver | undefined
): boolean {
	const first = soleProseBlock(candidate.firstRaw, resolver);
	const second = soleProseBlock(candidate.secondRaw, resolver);
	if (first === null || second === null) return false;
	// Each half must be a block the RELOAD keeps. Empty is one; whitespace-only is not, since the
	// document reads those bytes as blank trivia and the pair comes back a different shape.
	if (isWhitespaceOnly(first.visible) || isWhitespaceOnly(second.visible)) return false;
	if (!seam.closed.every((kind) => first.kinds.has(kind))) return false;
	if (!seam.reopened.every((kind) => second.kinds.has(kind))) return false;
	// The render oracle below counts characters while CSS collapses a terminal run to nothing, so
	// the "screen never showed it" rule is read here rather than trusted from the producer.
	if (candidate.droppedTail !== undefined && candidate.droppedTail.trim() !== '') return false;
	const whole = renderedText(
		parseInline(bytes.raw, bytes.contentStart, bytes.contentEnd, resolver),
		bytes.raw,
		CONTENT_VISIBILITY
	);
	if (!whole.startsWith(first.visible)) return false;
	// The line ending the cut landed on is the one character a split legitimately consumes; a
	// dropped tail is the only other, and the candidate names those bytes rather than the check
	// inferring them.
	const rest = whole.slice(first.visible.length);
	const tail = second.visible + (candidate.droppedTail ?? '');
	return rest === tail || rest === '\n' + tail || rest === '\r\n' + tail;
}

const isWhitespaceOnly = (visible: string): boolean => visible !== '' && visible.trim() === '';

function soleProseBlock(raw: string, resolver: LinkReferenceResolver | undefined): HalfRead | null {
	const sole = soleProseReparse(raw, resolver);
	if (sole === null) return null;
	return {
		visible: renderedText(sole.nodes, sole.block.raw, CONTENT_VISIBILITY),
		kinds: constructKinds(sole.nodes)
	};
}
