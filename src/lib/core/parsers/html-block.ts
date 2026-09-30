/**
 * HTML block parser, CommonMark §4.6: seven block types, each with its own close
 * condition. Types 1-5 close on a per-type pattern; types 6-7 close on a blank line.
 */

import { WHITESPACE_CLASS, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';
import { OPEN_TAG_SOURCE, CLOSE_TAG_SOURCE } from '../inline/html-tag-grammar';

export type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── Per-type opener patterns ────────────────────────────────────────────────
// Priority 1 → 7, first match wins. script/pre/style/textarea must stay out of type 6's
// tag union: they close on their end tag, not on a blank line.

// A tag name ends at GFM whitespace (§2.1), `/`, `>` or the line's end.
const TAG_NAME_END = `(?:${WHITESPACE_CLASS}|[/>]|$)`;
const TYPE_1_OPEN = new RegExp(`^ {0,3}<(?:script|pre|style|textarea)${TAG_NAME_END}`, 'i');
const TYPE_2_OPEN = /^ {0,3}<!--/;
const TYPE_3_OPEN = /^ {0,3}<\?/;
const TYPE_4_OPEN = /^ {0,3}<![A-Za-z]/;
const TYPE_5_OPEN = /^ {0,3}<!\[CDATA\[/;
const TYPE_6_TAGS =
	'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul';

function type6Shape(names: string): string {
	return `^ {0,3}<(/?)(?:${names})${TAG_NAME_END}`;
}

const TYPE_6_OPEN = new RegExp(type6Shape(TYPE_6_TAGS), 'i');

/** Recognize a type-6 tag line, open or close, for one tag name, built from the type-6 union so a
 *  terminator tests the spec's looseness (`</DETAILS>`, `<details >`) rather than a copy of it. */
export function htmlBlockTagLineMatcher(
	tagName: string
): (text: string) => 'open' | 'close' | null {
	const pattern = new RegExp(type6Shape(tagName), 'i');
	return (text) => {
		const m = pattern.exec(text);
		return m === null ? null : m[1] === '/' ? 'close' : 'open';
	};
}

// CommonMark §6.6's complete-tag grammar at line scope, from the inline raw-HTML sources. Last in
// priority, so types 1 and 6 take their tag names first, as the spec requires.
const TYPE_7_OPEN = new RegExp(
	`^ {0,3}(?:${OPEN_TAG_SOURCE}|${CLOSE_TAG_SOURCE})${WHITESPACE_CLASS}*$`
);

export function matchHtmlBlock(text: string): HtmlBlockType | null {
	if (TYPE_1_OPEN.test(text)) return 1;
	if (TYPE_2_OPEN.test(text)) return 2;
	if (TYPE_3_OPEN.test(text)) return 3;
	if (TYPE_4_OPEN.test(text)) return 4;
	if (TYPE_5_OPEN.test(text)) return 5;
	if (TYPE_6_OPEN.test(text)) return 6;
	if (TYPE_7_OPEN.test(text)) return 7;
	return null;
}

/** Types 1-6 interrupt a paragraph; type 7 (catch-all complete tags) cannot, per §4.6. */
export function canInterruptParagraph(text: string): boolean {
	const type = matchHtmlBlock(text);
	return type !== null && type !== 7;
}

// ── Per-type close conditions ───────────────────────────────────────────────

const TYPE_1_CLOSE = /<\/(?:script|pre|style|textarea)>/i;

function closesOnLine(type: HtmlBlockType, text: string): boolean {
	switch (type) {
		case 1:
			return TYPE_1_CLOSE.test(text);
		case 2:
			return text.includes('-->');
		case 3:
			return text.includes('?>');
		case 4:
			return text.includes('>');
		case 5:
			return text.includes(']]>');
		case 6:
		case 7:
			return isBlankLine(text);
	}
}

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseHtmlBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	type: HtmlBlockType
): BlockOpenerResult {
	let i = startIndex;
	while (i < endIndex) {
		if (closesOnLine(type, lines[i].text)) {
			// Types 6-7 leave their closing blank line out so parseBlocks takes it as pendingTrivia.
			if (type !== 6 && type !== 7) i++;
			break;
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'htmlBlock', leadingTrivia, raw },
		consumed: i - startIndex
	};
}
