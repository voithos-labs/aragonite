/**
 * The bytes an insertion produces while marks are pending. A mark resolves against the caret's
 * chain of enclosing constructs (live-mode.md § 4.3): a kind the chain lacks wraps the insertion,
 * a kind it already has escapes it. Flanking rules mean a splice that reads right can parse wrong
 * (`**hello**X** world**` renders literal stars), so every candidate is reparsed and checked.
 */

import {
	constructContentRange,
	constructKinds,
	inlineDescendants,
	readInline
} from '../../../core/inline';
import { CONTENT_VISIBILITY, renderedText } from '../../../core/inline/visibility';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import {
	getInlineConstructPolicy,
	getInlineMarkPolicy,
	listInlineMarks,
	type InlineMark,
	type InlineMarkKind
} from '../../../schema/inline-construct-policy';
import type { Reading } from '../../../schema/reading';
import { insertsExactly } from './screen-diff';

export interface MarkedInsertion {
	/** The block's whole displayed text after the insertion. */
	raw: string;
	/** Where the caret lands: after the inserted text, inside whatever now wraps it. */
	caret: number;
}

/** The insertion `text` at `caretOffset` makes under `marks`, or null when no candidate parses back
 *  as asked. `reading` must be the one `inlines` was read with. */
export function resolveMarkedInsertion(
	display: string,
	caretOffset: number,
	text: string,
	marks: ReadonlySet<InlineMarkKind>,
	inlines: readonly InlineNode[],
	reading: Reading
): MarkedInsertion | null {
	if (marks.size === 0 || text.length === 0) return null;

	const chain = constructChainAt(caretOffset, inlines);
	const removed = chain.filter((node) => node.mark !== null && marks.has(node.mark));
	const applied = listInlineMarks()
		.map((entry) => entry.kind)
		.filter((kind) => marks.has(kind) && !chain.some((node) => node.mark === kind));
	const removedKinds = new Set<AnyInlineKind>(removed.map((node) => node.kind));
	// Ancestors with no mark stay in the intended chain, which stops an escape from carrying the
	// byte out of a link it was inside.
	const intended = new Set<AnyInlineKind>([
		...chain.map((node) => node.kind).filter((kind) => !removedKinds.has(kind)),
		...applied
	]);

	const before = { visible: visibleText(display, reading), kinds: constructKinds(inlines) };
	for (const candidate of candidateInsertions(
		display,
		caretOffset,
		text,
		chain,
		removed,
		intended
	)) {
		if (parsesAsIntended(candidate, text, intended, before, reading)) {
			return { raw: candidate.raw, caret: candidate.textAt + text.length };
		}
	}
	return null;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface Candidate {
	raw: string;
	/** Where `text` itself begins in `raw`, the span the check reads the chain around. */
	textAt: number;
}

/**
 * In preference order: the in-place rewrite first, because a split keeps the user's text where
 * they put it; then stepping outside the removed construct, nearer edge first.
 */
function* candidateInsertions(
	display: string,
	caretOffset: number,
	text: string,
	chain: readonly ChainNode[],
	removed: readonly ChainNode[],
	intended: ReadonlySet<AnyInlineKind>
): Generator<Candidate> {
	if (removed.length === 0) {
		// Nothing is escaped, so every construct the caret sits in still provides its kind.
		yield spliceWrapped(display, caretOffset, text, marksToWrite(intended, chain));
		return;
	}

	const outermost = removed[0];
	const depth = chain.indexOf(outermost);
	const escaped = chain.slice(depth);
	const outside = chain.slice(0, depth);
	const payload = marksToWrite(intended, outside);

	// A link or widget between the caret and the escaped construct cannot be cut open, since its
	// closer does not mirror its opener, so only stepping outside is tried.
	if (escaped.every((node) => isSymmetricPair(node.kind))) {
		yield splitOpen(display, caretOffset, text, escaped, payload);
	}

	const nearerIsStart = caretOffset - outermost.contentStart <= outermost.contentEnd - caretOffset;
	const sides = nearerIsStart ? [outermost.start, outermost.end] : [outermost.end, outermost.start];
	for (const at of sides) yield spliceWrapped(display, at, text, payload);
}

/** The marks the insertion must write for itself: the intended ones its surroundings do not
 *  already provide, outermost first. */
function marksToWrite(
	intended: ReadonlySet<AnyInlineKind>,
	provided: readonly ChainNode[]
): InlineMark[] {
	return listInlineMarks().filter(
		({ kind }) => intended.has(kind) && !provided.some((node) => node.kind === kind)
	);
}

function spliceWrapped(
	display: string,
	at: number,
	text: string,
	payload: readonly InlineMark[]
): Candidate {
	const openers = payload.map((entry) => entry.mark.markerBytes).join('');
	const closers = [...payload]
		.reverse()
		.map((entry) => entry.mark.markerBytes)
		.join('');
	return {
		raw: display.slice(0, at) + openers + text + closers + display.slice(at),
		textAt: at + openers.length
	};
}

/** Close every escaped construct before the insertion and reopen it after. A side left empty
 *  steps outside the run instead, since live mode never writes a pair around nothing. */
function splitOpen(
	display: string,
	caretOffset: number,
	text: string,
	escaped: readonly ChainNode[],
	payload: readonly InlineMark[]
): Candidate {
	let leftEnd = caretOffset;
	let rightStart = caretOffset;
	let closers = '';
	let openers = '';
	for (const node of [...escaped].reverse()) {
		if (leftEnd === node.contentStart) leftEnd = node.start;
		else closers += display.slice(node.contentEnd, node.end);
		if (rightStart === node.contentEnd) rightStart = node.end;
		else openers = display.slice(node.start, node.contentStart) + openers;
	}
	const inner = spliceWrapped('', 0, text, payload);
	return {
		raw: display.slice(0, leftEnd) + closers + inner.raw + openers + display.slice(rightStart),
		textAt: leftEnd + closers.length + inner.textAt
	};
}

// ── Verification ─────────────────────────────────────────────────────────────

/** What the block was before the splice: what it showed, and every construct kind standing in it. */
interface BlockBefore {
	visible: string;
	kinds: ReadonlySet<AnyInlineKind>;
}

/** A candidate is written only if exactly the intended constructs enclose the inserted text, every
 *  construct the block held survives (a shared run can rebind), and nothing else shows a change. */
function parsesAsIntended(
	candidate: Candidate,
	text: string,
	intended: ReadonlySet<AnyInlineKind>,
	before: BlockBefore,
	reading: Reading
): boolean {
	const nodes = readInline(
		candidate.raw,
		0,
		candidate.raw.length,
		reading.resolver,
		reading.grammar
	);
	const around = enclosingKinds(nodes, candidate.textAt, candidate.textAt + text.length);
	if (around.size !== intended.size) return false;
	for (const kind of intended) if (!around.has(kind)) return false;
	const after = constructKinds(nodes);
	for (const kind of before.kinds) if (!after.has(kind)) return false;
	return insertsExactly(before.visible, visibleText(candidate.raw, reading, nodes), text);
}

/** The construct kinds covering `[start, end)`; `text` is content, not a construct. */
function enclosingKinds(
	nodes: readonly InlineNode[],
	start: number,
	end: number
): Set<AnyInlineKind> {
	const covers = (node: InlineNode): boolean => node.start <= start && end <= node.end;
	const kinds = new Set<AnyInlineKind>();
	for (const node of inlineDescendants(nodes, covers)) {
		if (covers(node) && node.kind !== 'text') kinds.add(node.kind);
	}
	return kinds;
}

/** What the user sees, asked of the render (G4.33). The content reading rather than the block's
 *  own: the first byte typed into an empty construct hides its markers, which is not a loss. */
function visibleText(raw: string, reading: Reading, parsed?: readonly InlineNode[]): string {
	return renderedText(
		parsed ?? readInline(raw, 0, raw.length, reading.resolver, reading.grammar),
		raw,
		CONTENT_VISIBILITY,
		{ grammar: reading.grammar }
	);
}

// ── The chain ────────────────────────────────────────────────────────────────

export interface ChainNode {
	kind: AnyInlineKind;
	/** The mark a chord can toggle, or null for a construct no chord addresses. */
	mark: InlineMarkKind | null;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

/** Read off the kind's row rather than a second list, so a new format joins in one place. */
function markOf(kind: AnyInlineKind): InlineMarkKind | null {
	return getInlineMarkPolicy(kind) ? kind : null;
}

/** Whether a construct's closer mirrors its opener, so a split can close and reopen it. The policy
 *  table answers, not this module's mark list: the rule is the table's to change. */
function isSymmetricPair(kind: AnyInlineKind): boolean {
	const edge = getInlineConstructPolicy(kind)?.edgeAffinity;
	return edge === 'left-sticky' || edge === 'boxed';
}

/** Every construct holding `offset`, outermost first; one missing here could be destroyed unnoticed.
 *  It descends only the constructs that hold `offset`, so `onVisit` hears each node it examined. */
export function constructChainAt(
	offset: number,
	inlines: readonly InlineNode[],
	onVisit?: () => void
): ChainNode[] {
	const chain: ChainNode[] = [];
	for (let level: readonly InlineNode[] | undefined = inlines; level;) {
		const holder = holderAt(level, offset, onVisit);
		if (!holder) break;
		const content = constructContentRange(holder);
		chain.push({
			kind: holder.kind,
			mark: markOf(holder.kind),
			start: holder.start,
			end: holder.end,
			contentStart: content?.start ?? holder.start,
			contentEnd: content?.end ?? holder.end
		});
		level = holder.children;
	}
	return chain;
}

/** The node of `nodes` (sorted by start, never overlapping) that holds `offset`, found by binary
 *  search: the last one starting at or before it, or the one ending where that one starts. */
function holderAt(
	nodes: readonly InlineNode[],
	offset: number,
	onVisit?: () => void
): InlineNode | null {
	let lo = 0;
	let hi = nodes.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (nodes[mid].start <= offset) lo = mid;
		else hi = mid - 1;
	}
	const last = nodes[lo];
	if (!last) return null;
	const candidates = last.start === offset && lo > 0 ? [nodes[lo - 1], last] : [last];
	for (const node of candidates) {
		onVisit?.();
		if (holdsOffset(node, offset)) return node;
	}
	return null;
}

/** Whether `offset` sits inside this construct, on the reading `constructChainAt` describes. Text
 *  is content, and nothing under it is a construct either. */
function holdsOffset(node: InlineNode, offset: number): boolean {
	if (node.kind === 'text') return false;
	const content = constructContentRange(node);
	return content
		? offset >= content.start && offset <= content.end
		: offset > node.start && offset < node.end;
}
