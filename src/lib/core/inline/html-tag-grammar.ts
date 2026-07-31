/**
 * CommonMark §6.6 HTML tag grammar, the one definition the inline `<` handler
 * (scan/autolinks.ts) and the block-level type-7 catch-all (parsers/html-block.ts) share.
 * The tag sources are exported so the block parser anchors them at line scope rather than
 * keeping a copy that could drift.
 */

export type HtmlFormKind = 'openTag' | 'closeTag' | 'comment' | 'pi' | 'declaration' | 'cdata';

const OPEN_TAG =
	/<[A-Za-z][A-Za-z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|"[^"]*"|'[^']*'))?)*\s*\/?>/;
const CLOSE_TAG = /<\/[A-Za-z][A-Za-z0-9-]*\s*>/;

/** Open tag `<name (attrs)* /?>` (CommonMark §6.6), unanchored source. */
export const OPEN_TAG_SOURCE = OPEN_TAG.source;
/** Close tag `</name>` with optional whitespace before `>`, unanchored source. */
export const CLOSE_TAG_SOURCE = CLOSE_TAG.source;

const OPEN_TAG_AT_POS = new RegExp(`^${OPEN_TAG_SOURCE}`);
const CLOSE_TAG_AT_POS = new RegExp(`^${CLOSE_TAG_SOURCE}`);

/** `pos` must point at `<`; every branch honors the `end` bound. */
export function matchHtmlFormAt(
	raw: string,
	pos: number,
	end: number
): { kind: HtmlFormKind; length: number } | null {
	if (pos >= end || raw[pos] !== '<' || pos + 1 >= end) return null;

	const next = raw[pos + 1];

	if (next === '!') {
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
