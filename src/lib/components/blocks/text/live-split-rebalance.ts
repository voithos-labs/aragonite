/**
 * The live-mode split rewrite (§ 4.4 close-and-reopen): Enter inside a construct closes it
 * before the cut and reopens it after, so neither half strands a delimiter run the reader never
 * saw, and a split link carries its destination to both. Bytes stay candidates until the parser
 * agrees — each half must re-parse to ONE prose block that still carries its constructs and
 * renders the same characters — after which `splitNode` keeps its byte-literal cut instead.
 */

import {
	constructContentRange,
	getContentRange,
	isProseKind,
	parseInline
} from '../../../core/inline';
import { renderedText } from '../../../core/inline-render';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import { parse } from '../../../core/parser';
import {
	getInlineConstructPolicy,
	type LiveSplitRebalancer
} from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const rebalanceLiveSplit: LiveSplitRebalancer = (
	node,
	offset,
	firstRaw,
	secondRaw,
	linkRef
) => {
	const bytes = readSplitBytes(node, offset, firstRaw, secondRaw);
	if (bytes === null) return null;
	const resolver = linkRef?.current;
	const chain = splittableChainAt(bytes, offset, resolver);
	if (chain === null || chain.length === 0) return null;
	const seam = seamParts(bytes, chain, offset);
	for (const candidate of [assemble(bytes, seam), assembleSpaceOutside(bytes, seam)]) {
		if (candidate !== null && parsesBack(bytes, seam, candidate, resolver)) return candidate;
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
 * Read the caller's two halves back against the original. Anchoring on the original bytes is what
 * keeps the rewrite honest about cuts it did not make: a container's body-write rule, a suffix
 * move, or a consumed line ending all show up here as an anchor that no longer matches.
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
 * Every construct holding `offset`, outermost first — or null when one of them declines. A kind
 * with no policy row, one whose split behavior is plain, and one whose content bounds are unknown
 * all cannot be cut open, and cutting the constructs inside it would strand its pair.
 */
function splittableChainAt(
	bytes: SplitBytes,
	offset: number,
	resolver: LinkReferenceResolver | undefined
): ChainLink[] | null {
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
	return visit(parseInline(bytes.raw, bytes.contentStart, bytes.contentEnd, resolver))
		? chain
		: null;
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
}

/**
 * Innermost first, so a closer run written before its enclosing one nests the halves the way the
 * original did. A side with no content of its own takes the whole construct instead of a pair
 * enclosing nothing — invisible `****` residue is what live mode may never write. Every link
 * either moves a side or writes a run, so a non-empty chain always describes a real rewrite.
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
 * closes a run against a word, never against whitespace, so a space left inside would kill the
 * construct outright; a space's formatting is invisible, which makes moving it the only reading
 * that both parses and looks unchanged. Null when neither side has one to move.
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

// ── Verification ─────────────────────────────────────────────────────────────

interface HalfRead {
	visible: string;
	kinds: Set<AnyInlineKind>;
}

/**
 * Three questions, and a candidate answers all of them or it is not written. Is each half one
 * prose block the reload KEEPS — the shape the caller's caret math and its multi-block dev warn
 * both assume? Did the constructs the seam closed and reopened survive? And does the render path
 * report the same characters as before, the one line ending the split itself consumed aside?
 */
function parsesBack(
	bytes: SplitBytes,
	seam: SeamParts,
	candidate: RebalancedHalves,
	resolver: LinkReferenceResolver | undefined
): boolean {
	const first = soleProseBlock(candidate.firstRaw, resolver);
	const second = soleProseBlock(candidate.secondRaw, resolver);
	if (first === null || second === null) return false;
	// Each half must be a block the RELOAD keeps. An EMPTY half is one — that is the ordinary
	// handover, and an empty block is what Enter at a content edge produces anyway — but a half
	// carrying only WHITESPACE is not: the document reads those bytes as blank trivia, so the
	// pair comes back a different shape than it was written in (#106, where the relocated space
	// landed as hard-break residue). The byte-literal cut converges there, and declining is what
	// leaves it standing.
	if (isWhitespaceOnly(first.visible) || isWhitespaceOnly(second.visible)) return false;
	if (!seam.closed.every((kind) => first.kinds.has(kind))) return false;
	if (!seam.reopened.every((kind) => second.kinds.has(kind))) return false;
	const whole = renderedText(
		parseInline(bytes.raw, bytes.contentStart, bytes.contentEnd, resolver),
		bytes.raw
	);
	if (!whole.startsWith(first.visible)) return false;
	// The one character a split legitimately consumes is the line ending its cut landed on.
	const rest = whole.slice(first.visible.length);
	return (
		rest === second.visible || rest === '\n' + second.visible || rest === '\r\n' + second.visible
	);
}

const isWhitespaceOnly = (visible: string): boolean => visible !== '' && visible.trim() === '';

function soleProseBlock(raw: string, resolver: LinkReferenceResolver | undefined): HalfRead | null {
	const blocks = parse(raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const range = getContentRange(block);
	const nodes = parseInline(block.raw, range.start, range.end, resolver);
	return { visible: renderedText(nodes, block.raw), kinds: constructKinds(nodes) };
}

function constructKinds(nodes: readonly InlineNode[]): Set<AnyInlineKind> {
	const kinds = new Set<AnyInlineKind>();
	const visit = (level: readonly InlineNode[]): void => {
		for (const node of level) {
			if (node.kind !== 'text') kinds.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(nodes);
	return kinds;
}
