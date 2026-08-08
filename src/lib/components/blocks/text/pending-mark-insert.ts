/**
 * The bytes an insertion produces while marks are pending, and the proof that they mean it. A
 * mark is resolved against the caret's construct chain (§ 4.3): a kind the chain lacks WRAPS the
 * insertion, a kind it carries escapes it — by splitting the construct close-and-reopen, or by
 * stepping outside it. Flanking rules and rule-of-three mean a splice that READS right can PARSE
 * wrong (`**hello**X** world**` renders literal stars), so no candidate is returned until it has
 * been re-parsed and checked: write bytes, let the parser decide.
 */

import { parseInline } from '../../../core/inline';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { constructContentRange } from './edge-seat';
import { markersFor } from './format-toggle';

/** Outermost first, so a set wraps to one byte string whatever order the chords arrived in. */
const NESTING_ORDER: readonly InlineMarkKind[] = ['strong', 'emphasis'];

export interface MarkedInsertion {
	/** The block's whole display bytes after the insertion. */
	raw: string;
	/** Where the caret lands — after the inserted text, inside whatever now wraps it. */
	caret: number;
}

/**
 * The insertion `text` at `caretOffset` makes under `marks`. Null when the marks name nothing to
 * do, or when no candidate parses back to what was asked — markdown cannot express every
 * combination at every caret, and a byte that types plain beats one that shows delimiters.
 */
export function resolveMarkedInsertion(
	display: string,
	caretOffset: number,
	text: string,
	marks: ReadonlySet<InlineMarkKind>,
	inlines: readonly InlineNode[]
): MarkedInsertion | null {
	if (marks.size === 0 || text.length === 0) return null;

	const chain = constructChainAt(caretOffset, inlines);
	const removed = chain.filter((node) => node.mark !== null && marks.has(node.mark));
	const applied = NESTING_ORDER.filter(
		(kind) => marks.has(kind) && !chain.some((node) => node.mark === kind)
	);
	const removedKinds = new Set<AnyInlineKind>(removed.map((node) => node.kind));
	// What must enclose the inserted text afterwards: every construct the caret was inside minus
	// the ones this chord removes, plus the ones it adds. Non-markable ancestors are in it too —
	// that is what stops an escape from carrying the byte out of a link it was inside.
	const intended = new Set<AnyInlineKind>([
		...chain.map((node) => node.kind).filter((kind) => !removedKinds.has(kind)),
		...applied
	]);

	const visibleBefore = visibleText(display);
	for (const candidate of candidateInsertions(
		display,
		caretOffset,
		text,
		chain,
		removed,
		intended
	)) {
		if (parsesAsIntended(candidate, text, intended, visibleBefore)) {
			return { raw: candidate.raw, caret: candidate.textAt + text.length };
		}
	}
	return null;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface Candidate {
	raw: string;
	/** Where `text` itself begins in `raw` — the span the verification reads the chain around. */
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

	// A link, a code span or a widget between the caret and the construct being escaped cannot be
	// cut open: its delimiters are not a symmetric pair the way a mark's are, and splicing inside
	// one writes literal bytes into content. Only stepping outside is available there.
	if (escaped.every((node) => node.mark !== null)) {
		yield splitOpen(display, caretOffset, text, escaped, payload);
	}

	const nearerIsStart = caretOffset - outermost.contentStart <= outermost.contentEnd - caretOffset;
	const sides = nearerIsStart ? [outermost.start, outermost.end] : [outermost.end, outermost.start];
	for (const at of sides) yield spliceWrapped(display, at, text, payload);
}

/** The markable kinds the insertion must declare for itself: the intended ones its surroundings
 *  do not already provide. */
function marksToWrite(
	intended: ReadonlySet<AnyInlineKind>,
	provided: readonly ChainNode[]
): InlineMarkKind[] {
	return NESTING_ORDER.filter(
		(kind) => intended.has(kind) && !provided.some((node) => node.kind === kind)
	);
}

function spliceWrapped(
	display: string,
	at: number,
	text: string,
	payload: readonly InlineMarkKind[]
): Candidate {
	const openers = payload.map(markersFor).join('');
	const closers = [...payload].reverse().map(markersFor).join('');
	return {
		raw: display.slice(0, at) + openers + text + closers + display.slice(at),
		textAt: at + openers.length
	};
}

/** Close every escaped construct before the insertion and reopen it after — the split that keeps
 *  the user's text where they put it. An empty half would leave a pair enclosing nothing, the
 *  invisible `****` residue live mode must never mint, so that side steps outside the run. */
function splitOpen(
	display: string,
	caretOffset: number,
	text: string,
	escaped: readonly ChainNode[],
	payload: readonly InlineMarkKind[]
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

/**
 * Two questions, and a candidate answers both or it is not written. Did the mark TAKE — do
 * exactly the intended constructs enclose the inserted text? And is the rewrite invisible
 * otherwise — is the only thing that changed on screen the one character that was typed?
 */
function parsesAsIntended(
	candidate: Candidate,
	text: string,
	intended: ReadonlySet<AnyInlineKind>,
	visibleBefore: string
): boolean {
	const nodes = parseInline(candidate.raw, 0, candidate.raw.length);
	const around = enclosingKinds(nodes, candidate.textAt, candidate.textAt + text.length);
	if (around.size !== intended.size) return false;
	for (const kind of intended) if (!around.has(kind)) return false;
	return insertsExactly(visibleBefore, visibleText(candidate.raw, nodes), text);
}

/** Whether `after` is `before` with `text` spliced in at one place and nothing else moved. */
function insertsExactly(before: string, after: string, text: string): boolean {
	if (after.length !== before.length + text.length) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return (
		after.slice(at, at + text.length) === text && after.slice(at + text.length) === before.slice(at)
	);
}

/** The construct kinds covering `[start, end)`; `text` is content, not a construct. */
function enclosingKinds(
	nodes: readonly InlineNode[],
	start: number,
	end: number
): Set<AnyInlineKind> {
	const kinds = new Set<AnyInlineKind>();
	const visit = (level: readonly InlineNode[]): void => {
		for (const node of level) {
			if (node.start > start || end > node.end) continue;
			if (node.kind !== 'text') kinds.add(node.kind);
			if (node.children) visit(node.children);
		}
	};
	visit(nodes);
	return kinds;
}

/**
 * Leaf content with every delimiter run dropped — what a reader sees. NOT a renderer: it only
 * has to be CONSISTENT, because the one thing asked of it is whether two versions of the same
 * block look the same. Counting the delimiter BYTES instead was not enough — this rewrite only
 * ever writes `*`, but it can kill a `_` pair beside it, and that pair's bytes then surface.
 */
function visibleText(raw: string, parsed?: readonly InlineNode[]): string {
	let out = '';
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.children && node.children.length > 0) visit(node.children);
			else if (node.kind === 'inlineCode') out += node.text ?? '';
			else out += raw.slice(node.start, node.end);
		}
	};
	visit(parsed ?? parseInline(raw, 0, raw.length));
	return out;
}

// ── The chain ────────────────────────────────────────────────────────────────

interface ChainNode {
	kind: AnyInlineKind;
	/** The mark a chord can toggle, or null for a construct no chord addresses. */
	mark: InlineMarkKind | null;
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

/** Derived from the nesting order rather than re-listed, so a new format joins in one place. */
function markOf(kind: AnyInlineKind): InlineMarkKind | null {
	return NESTING_ORDER.find((mark) => mark === kind) ?? null;
}

/**
 * EVERY construct whose content holds `offset`, outermost first — not just the markable ones,
 * because a link or a code span between the caret and the construct being escaped decides
 * whether that escape may cut anything. Content-inclusive at both ends: at a trailing content
 * edge continued typing extends the construct, so that is where a toggle-off must escape it.
 */
function constructChainAt(offset: number, inlines: readonly InlineNode[]): ChainNode[] {
	const chain: ChainNode[] = [];
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const content = constructContentRange(node);
			if (!content || offset < content.start || offset > content.end) continue;
			chain.push({
				kind: node.kind,
				mark: markOf(node.kind),
				start: node.start,
				end: node.end,
				contentStart: content.start,
				contentEnd: content.end
			});
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return chain;
}
