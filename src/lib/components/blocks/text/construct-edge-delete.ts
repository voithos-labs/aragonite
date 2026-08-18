/**
 * What a destructive key takes at an inline construct's unpainted delimiter run: the adjacent
 * CONTENT character, plus the delimiters the cut leaves enclosing nothing (live-mode.md § 4.4
 * `autoUnwrapOnEmpty`). Bytes that read right can parse wrong, so a candidate is written only once
 * a re-parse says the reader lost exactly what the cut aimed at.
 */

import {
	constructContentRange,
	inlineDescendants,
	parseInline,
	type ContentRange
} from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	renderedText,
	type VisibilityContext
} from '../../../core/inline/visibility';
import type { InlineNode } from '../../../core/nodes';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';
import { removesExactly, soleProseReparse } from './screen-diff';

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
	/** How the block reads on screen. Required, so a second caller cannot inherit the hiding
	 *  assumption by silence. */
	screen: VisibilityContext;
	/** The inline tree the render painted from, so the runs skipped here are the runs hidden. */
	inlines: readonly InlineNode[];
	/** What the caller installs the rewrite as, which is what the candidate is read back as.
	 *  Required for the same reason `screen` is: a cell's text is never a block. */
	installedAs: EdgeDeletionSurface;
}

/** A prose surface installs a block; a table cell installs cell text, whose bytes read as a list or
 *  a quote the moment they open with `- ` or `> ` though the cell paints neither. */
export type EdgeDeletionSurface = 'block' | 'cell';

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
	// Painted delimiters are bytes the reader saw, so no run here is this arm's to protect and the
	// license to drop one (live-mode.md § 2) does not reach: the press is the engine's. Every
	// oracle call below is past this gate, which is why they can all take the content reading.
	if (query.screen.chromePaints) return null;
	const { display, content, caret, direction } = query;
	const constructs = policyConstructs(query.inlines);
	const target = deletionTarget(display, constructs, content, caret, direction);
	if (!target) return null;

	// The adjacency that decides is the deleted SPAN's, not the caret's: the engine deletes from
	// where the byte is. With no run beside the cut the press stays with the engine, which owns
	// grapheme and IME behavior.
	const plain = expandThroughEmptied(constructs, target);
	const native = nativeCut(caret, direction);
	const touchesHiddenRun =
		isDelimiterByte(constructs, target.start - 1) || isDelimiterByte(constructs, target.end);
	if (!touchesHiddenRun && plain.start === native.start && plain.end === native.end) return null;

	const before = visibleText(display, query.installedAs);
	if (before === null) return null;
	const removed = target.atomic
		? renderedText([target.atomic], display, CONTENT_VISIBILITY)
		: display.slice(target.start, target.end);
	for (const cut of [plain, widenThroughRuns(constructs, plain)]) {
		const raw = display.slice(0, cut.start) + display.slice(cut.end);
		const after = visibleText(raw, query.installedAs);
		if (after === null || !removesExactly(before, after, removed)) continue;
		// Backward lands where the cut opened; forward keeps the caret where it was, which the cut
		// only moves when it swallowed delimiters ahead of it.
		return { raw, caret: direction === 'backward' ? cut.start : Math.min(caret, cut.start) };
	}
	return { swallow: true };
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

/**
 * The second reading of a press whose plain cut does not parse back: take the delimiter runs the
 * cut now sits between with it, the "these two constructs become one" a reader sees when the
 * character between them goes. Verified against the SCREEN, not the structure.
 */
function widenThroughRuns(constructs: readonly PolicyConstruct[], cut: Span): Span {
	let { start, end } = cut;
	while (isDelimiterByte(constructs, start - 1)) start--;
	while (isDelimiterByte(constructs, end)) end++;
	return { start, end };
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
	for (const node of inlineDescendants(inlines)) {
		const policy = getInlineConstructPolicy(node.kind);
		if (!policy) continue;
		found.push({
			node,
			content: constructContentRange(node),
			autoUnwrapOnEmpty: policy.autoUnwrapOnEmpty
		});
	}
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

/**
 * What a reader sees, asked of the thing that paints it, over the bytes read back the way `surface`
 * installs them — null where they do not read back at all. The content reading, not the block's
 * own: a cut that empties a construct folds its chrome into view, and the diff would read that
 * arrival as bytes lost; sound because the painting-chrome case returned at the door.
 */
function visibleText(raw: string, surface: EdgeDeletionSurface): string | null {
	// Cell text is never a block, so it reads as its inline content and nothing else can refuse it.
	if (surface === 'cell')
		return renderedText(parseInline(raw, 0, raw.length), raw, CONTENT_VISIBILITY);
	// A cut that empties the block is the one candidate with no block to read: emptied is a shape
	// the reload keeps, so it answers for itself rather than through the parser.
	if (raw === '') return '';
	// A candidate that re-reads as another block is not what the caller is about to install: a cut
	// can abut two literal runs into a fence opener, which on reload swallows every block below.
	const sole = soleProseReparse(raw);
	if (sole === null) return null;
	return renderedText(sole.nodes, sole.block.raw, CONTENT_VISIBILITY);
}
