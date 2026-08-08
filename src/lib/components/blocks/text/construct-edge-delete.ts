/**
 * What a destructive key takes at an inline construct's unpainted delimiter run: the adjacent
 * CONTENT character, plus the delimiters the cut leaves enclosing nothing (§ 4.4
 * `autoUnwrapOnEmpty`), which is what makes invisible `****` residue unrepresentable. Bytes that
 * read right can parse wrong, so a candidate is written only once a re-parse says the reader lost
 * exactly what the cut aimed at; a press this arm owns but cannot rewrite soundly takes nothing.
 */

import { constructContentRange, parseInline, type ContentRange } from '../../../core/inline';
import { renderedText } from '../../../core/inline-render';
import type { InlineNode } from '../../../core/nodes';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';

// ── Public API ───────────────────────────────────────────────────────────────

export type DeleteDirection = 'backward' | 'forward';

/** Named fields rather than a positional row: `display`, the two ranges and the caret are all
 *  offsets into the same string, and a swapped pair would type-check. */
export interface EdgeDeletionQuery {
	/** The block's display bytes — its raw without the trailing line ending. */
	display: string;
	/** The bytes the block's own kind calls content; a cut never reaches past them. */
	content: ContentRange;
	caret: number;
	direction: DeleteDirection;
	/** The inline tree the render painted from, so the runs skipped here are the runs hidden. */
	inlines: readonly InlineNode[];
}

export interface EdgeDeletionWrite {
	/** The block's whole display bytes after the cut. */
	raw: string;
	caret: number;
}

/** The press is this arm's but no rewrite parses back: taking nothing is the only answer that
 *  keeps the markers off screen, since the engine's version paints them. */
export interface EdgeDeletionSwallow {
	swallow: true;
}

export type EdgeDeletion = EdgeDeletionWrite | EdgeDeletionSwallow;

/**
 * What a destructive key at `caret` does, or null when the press is not this arm's — nothing
 * content-side of the caret, or a cut with no hidden run beside it, which the engine gets right.
 */
export function resolveEdgeDeletion(query: EdgeDeletionQuery): EdgeDeletion | null {
	const { display, content, caret, direction } = query;
	const constructs = policyConstructs(query.inlines);
	const target = deletionTarget(display, constructs, content, caret, direction);
	if (!target) return null;

	// Native takes the whole non-rendered span along with the character (measured: `Some **bold**
	// text` backspaced at `bold`'s end became `Some **bol text`). The adjacency that decides is
	// the deleted SPAN's, not the caret's — the engine deletes from where the byte is, so the last
	// content character at either end is destructive one press before the edge. With no run beside
	// the cut the press stays with the engine, which owns grapheme and IME behavior.
	const cut = expandThroughEmptied(constructs, target);
	const native = nativeCut(caret, direction);
	const touchesHiddenRun =
		isDelimiterByte(constructs, target.start - 1) || isDelimiterByte(constructs, target.end);
	if (!touchesHiddenRun && cut.start === native.start && cut.end === native.end) return null;

	const raw = display.slice(0, cut.start) + display.slice(cut.end);
	const removed = target.atomic
		? renderedText([target.atomic], display)
		: display.slice(target.start, target.end);
	if (!removesExactly(visibleText(display), visibleText(raw), removed)) return { swallow: true };
	// Backward lands where the cut opened; forward keeps the caret where it was, which the cut
	// only moves when it swallowed delimiters ahead of it.
	return { raw, caret: direction === 'backward' ? cut.start : Math.min(caret, cut.start) };
}

// ── The cut ──────────────────────────────────────────────────────────────────

interface Span {
	start: number;
	end: number;
}

interface Target extends Span {
	/** The construct deleted whole, for a run whose bytes mean nothing apart. */
	atomic: InlineNode | null;
}

function nativeCut(caret: number, direction: DeleteDirection): Span {
	return direction === 'backward'
		? { start: caret - 1, end: caret }
		: { start: caret, end: caret + 1 };
}

/**
 * The first thing the reader can see on `direction`'s side of the caret: delimiter bytes are
 * stepped over, an atomic run is taken whole, and the walk stops at the content range because the
 * block's own structural bytes are not this arm's to touch.
 */
function deletionTarget(
	display: string,
	constructs: readonly PolicyConstruct[],
	content: ContentRange,
	caret: number,
	direction: DeleteDirection
): Target | null {
	const step = direction === 'backward' ? -1 : 1;
	for (
		let at = direction === 'backward' ? caret - 1 : caret;
		at >= content.start && at < content.end;
		at += step
	) {
		const atomic = constructs.find((c) => !c.content && covers(c.node, at));
		if (atomic) return { start: atomic.node.start, end: atomic.node.end, atomic: atomic.node };
		if (!isDelimiterByte(constructs, at)) return { ...codePointAt(display, at), atomic: null };
	}
	return null;
}

/** The whole code point `at` belongs to. Half a surrogate pair is not a character, and this arm
 *  claims presses beside a hidden run wherever they land — emoji included. */
function codePointAt(display: string, at: number): Span {
	const start = isLowSurrogate(display, at) && isHighSurrogate(display, at - 1) ? at - 1 : at;
	return { start, end: isHighSurrogate(display, start) ? start + 2 : start + 1 };
}

function isHighSurrogate(display: string, at: number): boolean {
	const code = display.charCodeAt(at);
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(display: string, at: number): boolean {
	const code = display.charCodeAt(at);
	return code >= 0xdc00 && code <= 0xdfff;
}

/** A pair left around nothing is invisible residue, so a construct the cut empties goes with it —
 *  repeatedly, since dropping the inner pair can empty its parent. */
function expandThroughEmptied(constructs: readonly PolicyConstruct[], target: Target): Span {
	const cut: Span = { start: target.start, end: target.end };
	let grew = true;
	while (grew) {
		grew = false;
		for (const { node, content, autoUnwrapOnEmpty } of constructs) {
			if (!autoUnwrapOnEmpty || !content) continue;
			if (content.start < cut.start || content.end > cut.end) continue;
			if (node.start >= cut.start && node.end <= cut.end) continue;
			cut.start = Math.min(cut.start, node.start);
			cut.end = Math.max(cut.end, node.end);
			grew = true;
		}
	}
	return cut;
}

// ── Constructs ───────────────────────────────────────────────────────────────

interface PolicyConstruct {
	node: InlineNode;
	/** Null for a construct whose delimiters enclose no content of their own — an escape, a hard
	 *  break — which therefore has nothing to delete a character out of. */
	content: Span | null;
	autoUnwrapOnEmpty: boolean;
}

/** Only kinds the policy table names take part: an unpolicied construct's bytes are read as
 *  ordinary content, which is what native already treats them as. */
function policyConstructs(inlines: readonly InlineNode[]): PolicyConstruct[] {
	const found: PolicyConstruct[] = [];
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			const policy = getInlineConstructPolicy(node.kind);
			if (policy) {
				found.push({
					node,
					content: constructContentRange(node),
					autoUnwrapOnEmpty: policy.autoUnwrapOnEmpty
				});
			}
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return found;
}

function covers(node: InlineNode, at: number): boolean {
	return at >= node.start && at < node.end;
}

function isDelimiterByte(constructs: readonly PolicyConstruct[], at: number): boolean {
	return constructs.some(
		({ node, content }) =>
			content !== null &&
			((at >= node.start && at < content.start) || (at >= content.end && at < node.end))
	);
}

// ── Verification ─────────────────────────────────────────────────────────────

/** Whether `after` is `before` with exactly `removed` gone from one place — the whole claim a cut
 *  makes to the reader, asked of the bytes the parser produced rather than the ones it was given. */
function removesExactly(before: string, after: string, removed: string): boolean {
	if (after.length !== before.length - removed.length) return false;
	let at = 0;
	while (at < after.length && before[at] === after[at]) at++;
	return (
		before.slice(at, at + removed.length) === removed &&
		after.slice(at) === before.slice(at + removed.length)
	);
}

/** What a reader sees, asked of the thing that paints it: the render path's own DOM with every
 *  marker span dropped. A private walk over the parse cannot know which bytes a kind hides. */
function visibleText(raw: string): string {
	return renderedText(parseInline(raw, 0, raw.length), raw);
}
