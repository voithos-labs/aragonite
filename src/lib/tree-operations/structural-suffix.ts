/**
 * Where a cut through a heading leaves its structure: the marker in front of the text and the
 * bytes past it (a closing `#` run, a setext underline) stay with the text. Every split, paste
 * and join that divides a block at a caret cuts through here (`docs/design/editor.md` § 8).
 */

import { headingLevel } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { getContentRange, structuralSuffix } from '../core/inline';
import {
	displayLength,
	ownTrailingLineEnding,
	snapToScalarBoundary,
	trimTrailingLineEnding
} from '../core/lines';

/** `node`'s text cut at `offset` for a split or a paste, both halves without a final line ending.
 *  A cut at or before an ATX heading's text moves the whole heading into `rest`. */
export function cutKeepingStructure(
	node: NodeView,
	offset: number
): { head: string; rest: string } {
	const display = trimTrailingLineEnding(node.raw);
	// The cut leaves a surrogate pair whole, since its halves would land in different blocks.
	const cut = headingHeadCut(node, snapToScalarBoundary(display, offset));
	const suffix = structuralSuffix(node);
	const textEnd = display.length - suffix.length;
	if (suffix === '' || cut === 0 || cut > textEnd) {
		return { head: display.slice(0, cut), rest: display.slice(cut) };
	}
	// A remainder opening with a whitespace-only line reloads as blank, so the head takes it.
	const wsLine = /^[ \t]+\r?\n/.exec(display.slice(cut, textEnd))?.[0] ?? '';
	return {
		// The suffix opens with the ending of the line it follows, so one already on the head goes.
		head: trimTrailingLineEnding(display.slice(0, cut) + trimTrailingLineEnding(wsLine)) + suffix,
		rest: display.slice(cut + wsLine.length, textEnd)
	};
}

function headingHeadCut(node: NodeView, cut: number): number {
	if (headingLevel(node) === null) return cut;
	const content = getContentRange(node);
	if (content.start === 0 || content.end === content.start) return cut;
	return cut <= content.start ? 0 : cut;
}

/** A cut into `node` moved out of its structural suffix: a join or a truncation that keeps the
 *  block's head keeps the suffix whole after it. */
export function cutBeforeSuffix(node: NodeView, cut: number): number {
	const suffix = structuralSuffix(node);
	return suffix ? Math.min(cut, displayLength(node.raw) - suffix.length) : cut;
}

/** The bytes of a join: `survivor` cut at `cut`, `absorbed`'s text from `from` through `writeTail`
 *  (the absorbed kind's write rule), then the survivor's structural suffix. */
export function joinKeepingSuffix(
	survivor: NodeView,
	cut: number,
	absorbed: NodeView,
	from: number,
	writeTail: (tail: string) => string
): { raw: string; start: number; end: number } {
	const kept = structuralSuffix(survivor);
	const dropped = structuralSuffix(absorbed);
	const start = cutBeforeSuffix(survivor, cut);
	const textEnd = displayLength(absorbed.raw) - dropped.length;
	const end = dropped ? Math.min(from, textEnd) : from;
	const tail = writeTail(
		dropped
			? absorbed.raw.slice(end, textEnd) + ownTrailingLineEnding(absorbed.raw)
			: absorbed.raw.slice(end)
	);
	return {
		raw:
			survivor.raw.slice(0, start) +
			trimTrailingLineEnding(tail) +
			kept +
			ownTrailingLineEnding(tail),
		start,
		end
	};
}
