/**
 * CommonMark §6.6 HTML tag grammar — shared between the block-level HTML
 * parser (`core/parsers/html-block.ts`, type 7 catch-all) and the inline raw
 * HTML stage (`core/inline/raw-html.ts`).
 *
 * Note: `core/parsers/html-block.ts` TYPE_7_OPEN duplicates the open/close
 * tag patterns wrapped with line anchors (^ {0,3} ... \s*$) for block-level
 * Type 7 detection. Both must stay in sync if §6.6 ever shifts.
 *
 * Each form's start trigger is unambiguous from the leading two chars, so
 * `matchHtmlFormAt` dispatches by `raw[pos]` + `raw[pos+1]` then runs the
 * form-specific matcher. All matchers honor the `end` bound.
 */

export type HtmlFormKind = 'openTag' | 'closeTag' | 'comment' | 'pi' | 'declaration' | 'cdata';

/** Open tag: `<name (attrs)* /?>` (CommonMark §6.6). */
const OPEN_TAG_AT_POS =
	/^<[A-Za-z][A-Za-z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|"[^"]*"|'[^']*'))?)*\s*\/?>/;

/** Close tag: `</name>` with optional trailing whitespace before `>`. */
const CLOSE_TAG_AT_POS = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/;

/** Try to match a single §6.10 HTML form at position `pos` in `raw`, bounded
 *  by `end`. Returns the matched form kind and length, or null if no form
 *  matches at that position. Position must point at `<`. */
export function matchHtmlFormAt(
	raw: string,
	pos: number,
	end: number
): { kind: HtmlFormKind; length: number } | null {
	if (pos >= end || raw[pos] !== '<' || pos + 1 >= end) return null;

	const next = raw[pos + 1];

	if (next === '!') {
		// <!-- comment, <![CDATA[, or <!NAME declaration
		if (raw.startsWith('<!--', pos)) {
			const closeAt = raw.indexOf('-->', pos + 4);
			if (closeAt === -1 || closeAt + 3 > end) return null;
			return { kind: 'comment', length: closeAt + 3 - pos };
		}
		if (raw.startsWith('<![CDATA[', pos)) {
			const closeAt = raw.indexOf(']]>', pos + 9);
			if (closeAt === -1 || closeAt + 3 > end) return null;
			return { kind: 'cdata', length: closeAt + 3 - pos };
		}
		// Declaration: <! followed by ASCII letter, then anything until >
		if (pos + 2 < end && /[A-Za-z]/.test(raw[pos + 2])) {
			const closeAt = raw.indexOf('>', pos + 3);
			if (closeAt === -1 || closeAt >= end) return null;
			return { kind: 'declaration', length: closeAt + 1 - pos };
		}
		return null;
	}

	if (next === '?') {
		const closeAt = raw.indexOf('?>', pos + 2);
		if (closeAt === -1 || closeAt + 2 > end) return null;
		return { kind: 'pi', length: closeAt + 2 - pos };
	}

	if (next === '/') {
		const slice = raw.slice(pos, end);
		const m = CLOSE_TAG_AT_POS.exec(slice);
		return m ? { kind: 'closeTag', length: m[0].length } : null;
	}

	if (/[A-Za-z]/.test(next)) {
		const slice = raw.slice(pos, end);
		const m = OPEN_TAG_AT_POS.exec(slice);
		return m ? { kind: 'openTag', length: m[0].length } : null;
	}

	return null;
}
