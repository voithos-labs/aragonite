/**
 * HTML block parser — CommonMark §4.6. Seven block types, each with its own
 * close condition. Types 1-5 close on a per-type pattern; types 6-7 close on
 * a blank line. `parseHtmlBlock` and `canInterruptParagraph` callers read
 * the type tag from `matchHtmlBlock`.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';

export type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── Per-type opener patterns ────────────────────────────────────────────────
// All patterns anchor to line start with 0-3 spaces of leading indent.
// Priority: try 1 → 7. First match wins. Script/pre/style/textarea are type 1
// (their own close condition) — they were previously folded into type 6's
// listed-tag union, which produced blank-line termination instead of </script>
// termination.

const TYPE_1_OPEN = /^ {0,3}<(?:script|pre|style|textarea)(?:[\s/>]|$)/i;
const TYPE_2_OPEN = /^ {0,3}<!--/;
const TYPE_3_OPEN = /^ {0,3}<\?/;
const TYPE_4_OPEN = /^ {0,3}<![A-Za-z]/;
const TYPE_5_OPEN = /^ {0,3}<!\[CDATA\[/;
const TYPE_6_OPEN =
	/^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul)(?:[\s/>]|$)/i;

// CommonMark §6.6 complete-tag grammar, restricted to start-of-line with
// 0-3 indent and trailing whitespace only:
//   open  = `<` tagname (whitespace attribute)* optional-whitespace `/`? `>`
//   close = `</` tagname optional-whitespace `>`
//   attribute      = whitespace attr-name (optional-whitespace `=` optional-whitespace attr-value)?
//   attr-name      = [A-Za-z_:] [A-Za-z0-9_.:-]*
//   attr-value     = unquoted | "double-quoted" | 'single-quoted'
//   unquoted       = [^\s"'=<>`]+
// Type 7 priority is LAST — types 1 and 6 claim their tag names first, so
// the spec's exclusion of the type-1 tag names is naturally handled.
const TYPE_7_OPEN =
	/^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|"[^"]*"|'[^']*'))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)\s*$/;

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

// ── Parser ──────────────────────────────────────────────────────────────────
// parseHtmlBlock keeps today's "walk until blank line" behavior for now;
// per-type close conditions land in Task 3.

export function parseHtmlBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'htmlBlock', leadingTrivia, raw },
		nextIndex: i
	};
}
