/**
 * HTML block parser — CommonMark §4.6. Seven block types, each with its own
 * close condition. Types 1-5 close on a per-type pattern; types 6-7 close on
 * a blank line. `parseHtmlBlock` and `canInterruptParagraph` callers read
 * the type tag from `matchHtmlBlock`.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import { OPEN_TAG_SOURCE, CLOSE_TAG_SOURCE } from '../inline/html-tag-grammar';

export type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── Per-type opener patterns ────────────────────────────────────────────────
// All patterns anchor to line start with 0-3 spaces of leading indent.
// Priority: try 1 → 7. First match wins. Script/pre/style/textarea must stay out
// of type 6's listed-tag union: they close on their end tag, not on a blank line.

const TYPE_1_OPEN = /^ {0,3}<(?:script|pre|style|textarea)(?:[\s/>]|$)/i;
const TYPE_2_OPEN = /^ {0,3}<!--/;
const TYPE_3_OPEN = /^ {0,3}<\?/;
const TYPE_4_OPEN = /^ {0,3}<![A-Za-z]/;
const TYPE_5_OPEN = /^ {0,3}<!\[CDATA\[/;
const TYPE_6_OPEN =
	/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$)/i;

// CommonMark §6.6 complete-tag grammar applied at line scope: the same open/
// close tag sources the inline raw-HTML stage uses (core/inline/html-tag-
// grammar.ts), wrapped with 0-3 indent before and whitespace-only after. Type 7
// priority is LAST — types 1 and 6 claim their tag names first, so the spec's
// exclusion of the type-1 tag names is naturally handled.
const TYPE_7_OPEN = new RegExp(`^ {0,3}(?:${OPEN_TAG_SOURCE}|${CLOSE_TAG_SOURCE})\\s*$`);

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

/**
 * True when `text` starts a paragraph-interrupting HTML block (types 1-6).
 * Type 7 (catch-all complete tags) explicitly cannot interrupt a paragraph
 * per CommonMark §4.6.
 */
export function canInterruptParagraph(text: string): boolean {
	const type = matchHtmlBlock(text);
	return type !== null && type !== 7;
}

// ── Per-type close conditions ───────────────────────────────────────────────
// Types 1-5 close on a per-type regex/substring match (case-insensitive for
// type 1, where any of </script>, </pre>, </style>, </textarea> closes any
// type-1 block per §4.6). Types 6-7 close on a blank line.

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
): { node: CstNode; nextIndex: number } {
	let i = startIndex;
	while (i < endIndex) {
		if (closesOnLine(type, lines[i].text)) {
			// Types 1-5: include the close-tag line. Types 6-7: leave the
			// blank line out so parseBlocks accumulates it as pendingTrivia.
			if (type !== 6 && type !== 7) i++;
			break;
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'htmlBlock', leadingTrivia, raw },
		nextIndex: i
	};
}
