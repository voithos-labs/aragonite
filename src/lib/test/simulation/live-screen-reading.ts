/**
 * What the user sees of a whole document in live mode, read from the tree rather than the DOM. The
 * per-block reading is the render path's own (`core/inline/visibility.ts`); this adds what a
 * document-wide check needs and what a block otherwise gets from its DOM: the content-empty data
 * attribute, and the block's leading marker, which paints under the same rule (live-mode.md § 4.1).
 */

import type { CstNode, Document } from '$lib/core/nodes';
import { getContentRange, isProseKind, parseInline } from '$lib/core/inline';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText,
	screenVisibility,
	visibleRuns
} from '$lib/core/inline/visibility';
import { displayLength } from '$lib/core/lines';
import { emptyConstructSpans } from '$lib/test/harness/live-oracles';

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
	if (renderedText(nodes, node.raw, CONTENT_VISIBILITY) !== '') return false;
	return range.start > 0 || paintsOnlyChrome(nodes, node.raw);
}

/** The content behind every marker family: the reading a before/after comparison needs, since a
 *  block's markers stop painting the moment content arrives and a screen diff would call that
 *  bytes lost. */
export function documentContentText(holder: Document | CstNode): string {
	return (holder.children ?? [])
		.map((child) => {
			if (child.children !== undefined) return documentContentText(child);
			if (!readable(child)) return child.raw;
			const range = getContentRange(child);
			const nodes = parseInline(child.raw, range.start, range.end);
			return renderedText(nodes, child.raw, CONTENT_VISIBILITY);
		})
		.join('\n');
}

/**
 * The residue live-mode.md § 4.1 forbids, counted where it actually hides: a delimiter pair
 * enclosing nothing whose every byte goes unpainted. The same run painted as literal text is on
 * screen, so it is a byte the user met rather than residue, which is the distinction § 4.1 draws.
 */
export function unpaintedResidue(holder: Document | CstNode): number {
	return (holder.children ?? []).reduce((total, child) => {
		if (child.children !== undefined) return total + unpaintedResidue(child);
		if (!readable(child)) return total;
		const range = getContentRange(child);
		const nodes = parseInline(child.raw, range.start, range.end);
		const ctx = screenVisibility('live', { chromePaints: chromePaints(child) });
		const painted = new Array<boolean>(child.raw.length).fill(false);
		for (const run of visibleRuns(nodes, child.raw, ctx)) {
			if (!run.visible) continue;
			for (let at = run.start; at < run.end; at++) painted[at] = true;
		}
		const hidden = emptyConstructSpans(child.raw, range).filter(
			(span) => !painted.slice(span.start, span.end).includes(true)
		);
		return total + hidden.length;
	}, 0);
}

/** Trailing whitespace collapses on screen, so a check comparing two readings must not see it: a
 *  live split may rightly drop a run the user never met (#106). */
export const normalizeScreen = (text: string): string =>
	text
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/, ''))
		.join('\n');

/**
 * The offsets a gesture aimed at a hidden edge lands on: every boundary of a run the user cannot
 * see, plus the start and end of the content. These are the positions live-mode.md § 1 calls
 * ambiguous, and an even draw reaches them too rarely to search between the scripted flows.
 */
export function hiddenEdgeOffsets(node: CstNode): number[] {
	if (!readable(node)) return [];
	const range = getContentRange(node);
	const nodes = parseInline(node.raw, range.start, range.end);
	const ctx = screenVisibility('live', { chromePaints: chromePaints(node) });
	const stops = new Set<number>([range.start, range.end]);
	for (const run of visibleRuns(nodes, node.raw, ctx)) {
		if (run.visible) continue;
		stops.add(run.start);
		stops.add(run.end);
	}
	return [...stops].filter((at) => at >= range.start && at <= range.end).sort((a, b) => a - b);
}
