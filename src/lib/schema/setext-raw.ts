/**
 * The setext heading's two byte facts: where its title ends, and its write rule, declared on the
 * kind as `rawWrite`. The underline line after the title is structure, kept under a title and
 * dropped under a blank line, where it would read as a block of its own.
 */

import type { NodeView } from '../core/node-views';
import { displayLines, isBlankLine, trimTrailingLineEnding } from '../core/lines';
import type { WriteRule } from './block-kind-descriptor';

/** The title's range in the heading's raw: everything before the break above the underline. */
export function setextHeadingContentRange(node: NodeView): { start: number; end: number } {
	const display = trimTrailingLineEnding(node.raw);
	const lines = displayLines(display);
	if (lines.length < 2) return { start: 0, end: display.length };
	const underline = lines[lines.length - 1];
	const breakAbove = lines[lines.length - 2].ending;
	return { start: 0, end: display.length - underline.text.length - breakAbove.length };
}

/** `raw` less the heading's underline when the line above it is blank, as an emptied ATX heading
 *  gives up its `#`. */
function dropUnderlineUnderBlankLine(node: NodeView, raw: string): string {
	const underline = trimTrailingLineEnding(node.raw).slice(setextHeadingContentRange(node).end);
	const display = trimTrailingLineEnding(raw);
	if (!underline || !display.endsWith(underline)) return raw;
	const title = display.slice(0, display.length - underline.length);
	const lastLine = title.slice(title.lastIndexOf('\n') + 1);
	return isBlankLine(lastLine) ? title + raw.slice(display.length) : raw;
}

export const setextHeadingWrite: WriteRule = {
	normalize: (raw, ctx) => dropUnderlineUnderBlankLine(ctx.node, raw),
	// The dropped underline sits after the blank line every caret stands on, so a caret past it
	// lands at the end of what is left.
	mapOffset: (raw, offset, ctx) =>
		Math.min(offset, dropUnderlineUnderBlankLine(ctx.node, raw).length)
};
