/**
 * Pure text and caret transforms for TextEditableBlock's structural gestures: demoting an empty
 * heading, inserting a hard break inside the text, inserting a literal tab. The component owns the
 * wiring; these own the string math. A heading level's bytes are `tree-operations/heading-level.ts`.
 */

import {
	getContentRange,
	sameLineSuffixOf,
	withHardBreak,
	type ContentRange
} from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import type { StoredAs } from '../../../schema/stored-as';
import { demoteToParagraph, type TextEditResult } from '../../../tree-operations/heading-level';
import { splitHalves } from '../../../tree-operations/node-ops';
import {
	displayLength,
	isBlankText,
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../../core/lines';

/** An ATX heading with no text draws nothing when unfocused, so on blur it becomes the empty
 *  paragraph it looks like rather than a `#` that reappears on the next click. */
export function demoteEmptyAtxHeading(raw: string, content: ContentRange): TextEditResult | null {
	if (content.start === 0 || content.end > content.start) return null;
	return demoteToParagraph(raw, content, 0);
}

/** A hard break at `offset` of `node`, cut where a paragraph break there cuts; where that cut closes
 *  and reopens a run, at `offset` itself, since a run may span a hard break. */
export function hardBreakAt(
	node: NodeView,
	offset: number,
	owner: NodeView | undefined,
	ending: LineEnding,
	store: StoredAs
): TextEditResult {
	const literal = () => insertHardBreak(node.raw, offset, ending, getContentRange(node));
	const cut = breakCut(node, offset, owner, ending, store);
	if (cut.from === offset && cut.to === offset) return literal();
	const raw = node.raw.slice(0, cut.from) + node.raw.slice(cut.to);
	const broken = insertHardBreak(raw, cut.from, ending, getContentRange({ ...node, raw }));
	// The line after the break must stay in the block: a rest that opens a block of its own there
	// (a heading under a list item's text) keeps the break where the caret is.
	const read = store.readWritten(broken.newRaw).children;
	return read.length === 1 && read[0].kind === node.kind ? broken : literal();
}

/** The bytes `[from, to)` a break at `offset` takes the place of: what a paragraph break there
 *  drops between its halves, where both halves are the block's own bytes, else the caret alone. */
function breakCut(
	node: NodeView,
	offset: number,
	owner: NodeView | undefined,
	ending: LineEnding,
	store: StoredAs
): { from: number; to: number } {
	const at = { from: offset, to: offset };
	const halves = splitHalves(node, offset, owner, ending, { first: store, second: store });
	const display = trimTrailingLineEnding(node.raw);
	const first = trimTrailingLineEnding(halves.firstRaw);
	const second = trimTrailingLineEnding(halves.secondRaw);
	const to = display.length - second.length;
	if (!display.startsWith(first) || !display.endsWith(second) || to < first.length) return at;
	if (!isBlankText(display.slice(first.length, to))) return at;
	// A line that already ends in a hard break keeps it: its backslash isn't one this break writes.
	if (/(^|[^\\])(\\\\)*\\$/.test(first)) return at;
	return { from: first.length, to };
}

/** A GFM hard break (a backslash at end of line) at `offset`, ended with `ending`, the typed break's;
 *  at the end of the text's line the pending break writes it instead (`caret/pending-break.svelte.ts`). */
export function insertHardBreak(
	raw: string,
	offset: number,
	ending: LineEnding,
	content: ContentRange
): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	// Only a break inside the text has the text line's closing run to keep on that line.
	const suffix =
		offset >= content.start && offset < content.end
			? { start: content.end, end: content.end + sameLineSuffixOf(raw, content.end).length }
			: { start: offset, end: offset };
	const broken = withHardBreak(display, offset, suffix, ending);
	// Past a setext underline's end the inserted ending is the trailing one; a second would add a
	// blank line.
	const newRaw = offset >= display.length ? broken.text : broken.text + ownTrailingLineEnding(raw);
	return { newRaw, caretOffset: Math.min(broken.lineStart, displayLength(newRaw)) };
}

/** A literal tab typed at `offset` into the displayed text. */
export function insertLiteralTab(
	display: string,
	offset: number
): { text: string; caretAfter: number } {
	return { text: display.slice(0, offset) + '\t' + display.slice(offset), caretAfter: offset + 1 };
}
