/**
 * What the user sees of a whole document in live mode, read from the tree rather than the DOM. The
 * per-block reading is the render path's own (`core/inline/visibility.ts`); this adds what a
 * document-wide check needs and what a block otherwise gets from its DOM: the content-empty data
 * attribute, and the block's leading marker, which paints under the same rule (live-mode.md § 4.1).
 */

import type { CstNode, Document } from '#lib/core/nodes.js';
import { getContentRange, isProseKind, parseInline } from '#lib/core/inline/index.js';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText,
	screenVisibility,
	visibleRuns
} from '#lib/core/inline/visibility.js';
import { displayLength } from '#lib/core/lines.js';
import {
	emptyConstructSpans,
	markedChars,
	type MarkedChar
} from '#lib/test/harness/live-oracles.js';
import { parse } from '#lib/core/parser.js';
import { hiddenEdges } from '#lib/components/blocks/text/edge-seat.js';
import { insertsExactly } from '#lib/components/blocks/text/screen-diff.js';
import { fixtureReading, renderOptions } from '../harness/fixture-grammar';

/** A prose leaf and the path that addresses it. */
export interface ProseLeaf {
	path: number[];
	node: CstNode;
}

export function proseLeaves(holder: Document | CstNode, path: number[] = []): ProseLeaf[] {
	return (holder.children ?? []).flatMap((child, index) => {
		const here = [...path, index];
		if (child.children !== undefined) return proseLeaves(child, here);
		return isProseKind(child.kind) ? [{ path: here, node: child }] : [];
	});
}

const readable = (node: CstNode): boolean =>
	isProseKind(node.kind) && getContentRange(node).end <= displayLength(node.raw);

/** Whether this block's markers stand over no content and therefore paint: the tree-side version of
 *  the `holdsOnlyMarkerChrome` data attribute a mounted block carries. */
export function chromePaints(node: CstNode): boolean {
	if (!readable(node)) return false;
	const range = getContentRange(node);
	const nodes = parseInline(node.raw, range.start, range.end);
	if (renderedText(nodes, node.raw, CONTENT_VISIBILITY, renderOptions()) !== '') return false;
	return range.start > 0 || paintsOnlyChrome(nodes, node.raw, renderOptions());
}

/** The content behind every marker, for before/after comparisons: a block's markers stop painting
 *  once content arrives, which a screen diff would call bytes lost. */
export function documentContentText(holder: Document | CstNode): string {
	return (
		(holder.children ?? [])
			.map((child) => {
				if (child.children !== undefined) return documentContentText(child);
				if (!readable(child)) return child.raw;
				const range = getContentRange(child);
				const nodes = parseInline(child.raw, range.start, range.end);
				return renderedText(nodes, child.raw, CONTENT_VISIBILITY, renderOptions());
			})
			.join('\n')
			// A CRLF pair draws as the one line break LF draws.
			.replace(/\r\n/g, '\n')
	);
}

/** Every character the document's prose shows, in order, with the constructs it is drawn in; a pair
 *  around nothing paints the glyphs a literal run shows, a block's own chrome is the screen check's. */
export function documentMarkedChars(holder: Document | CstNode): MarkedChar[] {
	const leaves = proseLeaves(holder).filter(({ node }) => readable(node));
	return markedChars(
		leaves.map(({ node }) => {
			const painted = paintedBytes(node, false);
			return { raw: node.raw, content: getContentRange(node), painted: (at) => painted[at] };
		})
	);
}

/** Which of a readable leaf's bytes live mode draws, with or without the block's own chrome. */
function paintedBytes(node: CstNode, blockChrome = chromePaints(node)): boolean[] {
	const range = getContentRange(node);
	const nodes = parseInline(node.raw, range.start, range.end);
	const ctx = screenVisibility('live', { chromePaints: blockChrome });
	const painted = new Array<boolean>(node.raw.length).fill(false);
	for (const run of visibleRuns(nodes, node.raw, ctx, renderOptions())) {
		if (!run.visible) continue;
		for (let at = run.start; at < run.end; at++) painted[at] = true;
	}
	return painted;
}

/** Delimiter pairs enclosing nothing whose every byte goes unpainted (live-mode.md § 4.1); the
 *  same run painted as literal text is a byte the user saw, not residue. */
export function unpaintedResidue(holder: Document | CstNode): number {
	return (holder.children ?? []).reduce((total, child) => {
		if (child.children !== undefined) return total + unpaintedResidue(child);
		if (!readable(child)) return total;
		const range = getContentRange(child);
		const painted = paintedBytes(child);
		const hidden = emptyConstructSpans(child.raw, range).filter(
			(span) => !painted.slice(span.start, span.end).includes(true)
		);
		return total + hidden.length;
	}, 0);
}

/** Trailing whitespace collapses on screen, so a check comparing two readings must not see it: a
 *  live split may rightly drop a run the user never saw. */
export const normalizeScreen = (text: string): string =>
	text
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''))
		.join('\n');

/** Whether no offset the caret's screen position admits takes `typed` with the screen and the
 *  block's kind kept: where live-mode.md § 4.2 lets the byte-literal write stand (§ 4.8 cues it). */
export function admitsNoSeat(node: CstNode, caret: number, typed: string): boolean {
	if (!readable(node)) return false;
	const range = getContentRange(node);
	const screen = screenVisibility('live', { chromePaints: chromePaints(node) });
	const reading = fixtureReading({}, 'live');
	const offsets = hiddenEdges(
		parseInline(node.raw, range.start, range.end),
		node.raw,
		screen,
		reading
	).seatOffsets(caret);
	const shown = (raw: string, end: number) =>
		renderedText(parseInline(raw, range.start, end), raw, CONTENT_VISIBILITY, renderOptions());
	const before = shown(node.raw, range.end);
	const keeps = (at: number) => {
		const candidate = node.raw.slice(0, at) + typed + node.raw.slice(at);
		const kind = parse(candidate).children;
		return (
			kind.length === 1 &&
			kind[0].kind === node.kind &&
			insertsExactly(before, shown(candidate, range.end + typed.length), typed)
		);
	};
	return offsets.length > 0 && !offsets.some(keeps);
}

/** Every boundary of a run the user cannot see, plus the content's ends: the positions live-mode.md
 *  § 1 calls ambiguous, which an even draw reaches too rarely. */
export function hiddenEdgeOffsets(node: CstNode): number[] {
	if (!readable(node)) return [];
	const range = getContentRange(node);
	const nodes = parseInline(node.raw, range.start, range.end);
	const ctx = screenVisibility('live', { chromePaints: chromePaints(node) });
	const stops = new Set<number>([range.start, range.end]);
	for (const run of visibleRuns(nodes, node.raw, ctx, renderOptions())) {
		if (run.visible) continue;
		stops.add(run.start);
		stops.add(run.end);
	}
	return [...stops].filter((at) => at >= range.start && at <= range.end).sort((a, b) => a - b);
}
