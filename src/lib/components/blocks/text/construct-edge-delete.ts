/**
 * What a destructive key takes at an inline construct's hidden delimiter run: the neighbouring
 * content character, plus the delimiters the cut leaves enclosing nothing (live-mode.md § 4.4
 * `autoUnwrapOnEmpty`). Bytes that read right can parse wrong, so a candidate is written only
 * once a reparse says the user lost exactly what the cut aimed at.
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
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { GrammarView } from '../../../schema/block-openers';
import { getInlineConstructPolicy } from '../../../schema/inline-construct-policy';
import { removesExactly, soleProseReparse } from './screen-diff';

// ── Public API ───────────────────────────────────────────────────────────────

export type DeleteDirection = 'backward' | 'forward';

/** Named fields rather than a positional row: `display`, the two ranges and the caret are all
 *  offsets into the same string, and a swapped pair would type-check. */
export interface EdgeDeletionQuery {
	/** The block's displayed text: its raw without the trailing line ending. */
	display: string;
	/** The bytes the block's own kind calls content; a cut never reaches past them. */
	content: ContentRange;
	caret: number;
	direction: DeleteDirection;
	/** How the block reads on screen. Required, so a second caller cannot inherit an assumption
	 *  about what is hidden by saying nothing. */
	screen: VisibilityContext;
	/** The inline tree the render drew from, so the runs skipped here are the runs really hidden. */
	inlines: readonly InlineNode[];
	/** What the caller installs the rewrite as, which is what the candidate is read back as.
	 *  Required for the same reason `screen` is: a cell's text is never a block. */
	installedAs: EdgeDeletionSurface;
	/** The editor's grammar, so a candidate reads back as the syntax the editor draws. */
	grammar: GrammarView;
}

/** A prose block stores a block; a table cell stores cell text, whose bytes read as a list or a
 *  quote the moment they start with `- ` or `> `, though the cell draws neither. */
export type EdgeDeletionSurface = 'block' | 'cell';

export interface EdgeDeletionWrite {
	/** The block's whole displayed text after the cut. */
	raw: string;
	caret: number;
	/** The marks of the constructs the cut emptied and unwrapped, for the caller to hold pending. */
	unwrappedMarks: readonly AnyInlineKind[];
}

/** The key belongs here but no rewrite parses back: taking nothing is the only answer that keeps
 *  the markers off screen, since the browser's version would show them. */
export interface EdgeDeletionSwallow {
	swallow: true;
}

export type EdgeDeletion = EdgeDeletionWrite | EdgeDeletionSwallow;

/**
 * What a destructive key at `caret` does, or null when it does not belong here: nothing on the
 * content side of the caret, or a cut with no hidden run beside it, which the browser gets right.
 */
export function resolveEdgeDeletion(query: EdgeDeletionQuery): EdgeDeletion | null {
	// Visible delimiters are bytes the user saw, so there is no hidden run to protect here and the
	// licence to drop one (live-mode.md § 2) does not apply: the key stays with the browser.
	// Everything below runs past this check, which is why it can all use the content reading.
	if (query.screen.chromePaints) return null;
	const { display, content, caret, direction } = query;
	const constructs = policyConstructs(query.inlines);
	const target = deletionTarget(display, constructs, content, caret, direction);
	if (!target) return null;

	// What decides is what sits beside the deleted span, not beside the caret: the browser deletes
	// from where the byte is. With no hidden run beside the cut the key stays with the browser,
	// which handles graphemes and IME.
	const plain = expandThroughEmptied(constructs, target);
	const native = nativeCut(caret, direction);
	const touchesHiddenRun =
		isDelimiterByte(constructs, target.start - 1) || isDelimiterByte(constructs, target.end);
	if (!touchesHiddenRun && plain.start === native.start && plain.end === native.end) return null;

	const before = visibleText(display, query.installedAs, query.grammar);
	if (before === null) return null;
	const removed = target.atomic
		? renderedText([target.atomic], display, CONTENT_VISIBILITY)
		: display.slice(target.start, target.end);
	for (const cut of [plain, widenThroughRuns(constructs, plain)]) {
		const raw = display.slice(0, cut.start) + display.slice(cut.end);
		const after = visibleText(raw, query.installedAs, query.grammar);
		if (after === null || !removesExactly(before, after, removed)) continue;
		// Backward lands where the cut opened; forward keeps the caret where it was, which the cut
		// only moves when it swallowed delimiters ahead of it.
		return {
			raw,
			caret: direction === 'backward' ? cut.start : Math.min(caret, cut.start),
			unwrappedMarks: plain.unwrappedMarks
		};
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
 * The first thing the user can see on `direction`'s side of the caret: delimiter bytes are
 * stepped over, an atomic run is taken whole, and the scan stops at the content range because
 * the block's own structural bytes are not ours to touch.
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

/** The whole code point `at` belongs to. Half a surrogate pair is not a character, and this module
 *  handles keys beside a hidden run wherever they land, emoji included. */
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
 * The second try for a key whose plain cut does not parse back: take the delimiter runs the cut
 * now sits between along with it, the "these two constructs become one" the user sees when the
 * character between them goes. Checked against the screen, not the structure.
 */
function widenThroughRuns(constructs: readonly PolicyConstruct[], cut: Span): Span {
	let { start, end } = cut;
	while (isDelimiterByte(constructs, start - 1)) start--;
	while (isDelimiterByte(constructs, end)) end++;
	return { start, end };
}

/** A delimiter pair left around nothing is invisible leftovers, so a construct the cut empties
 *  goes with it, repeatedly, since dropping the inner pair can empty its parent. */
function expandThroughEmptied(
	constructs: readonly PolicyConstruct[],
	target: Target
): Span & { unwrappedMarks: AnyInlineKind[] } {
	const cut = { start: target.start, end: target.end, unwrappedMarks: [] as AnyInlineKind[] };
	let grew = true;
	while (grew) {
		grew = false;
		for (const { node, content, autoUnwrapOnEmpty, markable } of constructs) {
			if (!autoUnwrapOnEmpty || !content) continue;
			if (content.start < cut.start || content.end > cut.end) continue;
			if (node.start >= cut.start && node.end <= cut.end) continue;
			cut.start = Math.min(cut.start, node.start);
			cut.end = Math.max(cut.end, node.end);
			if (markable) cut.unwrappedMarks.push(node.kind);
			grew = true;
		}
	}
	return cut;
}

// ── Constructs ───────────────────────────────────────────────────────────────

interface PolicyConstruct {
	node: InlineNode;
	/** Null for a construct whose delimiters enclose no content of their own, such as an escape or
	 *  a hard break, which has nothing to delete a character out of. */
	content: Span | null;
	autoUnwrapOnEmpty: boolean;
	/** Whether a format chord writes this kind's delimiters, so unwrapping it takes a mark off
	 *  the caret rather than only bytes. */
	markable: boolean;
}

/** Only kinds the policy table names take part: a construct with no policy has its bytes read as
 *  ordinary content, which is what the browser already treats them as. */
function policyConstructs(inlines: readonly InlineNode[]): PolicyConstruct[] {
	const found: PolicyConstruct[] = [];
	for (const node of inlineDescendants(inlines)) {
		const policy = getInlineConstructPolicy(node.kind);
		if (!policy) continue;
		found.push({
			node,
			content: constructContentRange(node),
			autoUnwrapOnEmpty: policy.autoUnwrapOnEmpty,
			markable: policy.mark !== undefined
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
 * What the user sees, asked of the code that draws it, over the bytes read back the way `surface`
 * stores them; null where they do not read back at all. The content reading, not the block's own:
 * a cut that empties a construct brings its markers into view, and the comparison would read that
 * as bytes lost. Safe, because the case where markers are drawn returned above.
 */
function visibleText(
	raw: string,
	surface: EdgeDeletionSurface,
	grammar: GrammarView
): string | null {
	// Cell text is never a block, so it reads as its inline content and nothing else can refuse it.
	if (surface === 'cell')
		return renderedText(
			parseInline(raw, 0, raw.length, undefined, grammar),
			raw,
			CONTENT_VISIBILITY
		);
	// A cut that empties the block is the one candidate with no block to read: empty stays empty
	// through a reparse, so it answers for itself rather than through the parser.
	if (raw === '') return '';
	// A candidate that parses back as a different block is not what the caller is about to store:
	// a cut can push two literal runs together into a fence opener, which then swallows the rest.
	const sole = soleProseReparse(raw, { grammar });
	if (sole === null) return null;
	return renderedText(sole.nodes, sole.block.raw, CONTENT_VISIBILITY);
}
