/**
 * Pure text transform: GitHub-alert blockquotes → `:::name` directive source.
 *
 *   > [!NOTE]        :::note
 *   > Body line   →  Body line
 *                    :::
 *
 * This is `source → source` only — it produces directive Markdown the editor's
 * own parser then turns into an admonition. Kept free of any editor import so it
 * unit-tests in isolation; the document-scoped wrapper (which needs `parse` to
 * skip code blocks) lives in `convert-document.ts`.
 */
import { ADMONITION_KINDS } from './kinds';

const ALERT_NAMES = new Set<string>(ADMONITION_KINDS);

/** `> [!NOTE]` alone on the line (case-insensitive type, optional indent/space). */
const MARKER = /^(\s*)>[ \t]*\[!([A-Za-z]+)\][ \t]*$/;

/** A blockquote continuation line: starts with `>` (after optional indent). */
const QUOTE_LINE = /^[ \t]*>/;

/** Strip one leading `>` and at most one following space/tab (GFM blockquote marker). */
function stripQuoteMarker(line: string): string {
	const m = /^[ \t]*>[ \t]?/.exec(line);
	return m ? line.slice(m[0].length) : line;
}

export interface AlertConversion {
	converted: string;
	changed: boolean;
}

/**
 * Convert one blockquote's exact raw bytes into `:::name` source, or null when
 * it is not a GitHub alert. GitHub only honors the `[!TYPE]` marker on the
 * blockquote's FIRST line; everything after — including lazy-continuation lines
 * and later literal `[!TYPE]` markers — is body, quote markers stripped.
 */
export function convertAlertBlockquoteRaw(raw: string): string | null {
	const trailingNewline = raw.endsWith('\n');
	const lines = (trailingNewline ? raw.slice(0, -1) : raw).split('\n');
	const marker = MARKER.exec(lines[0]);
	const name = marker?.[2]?.toLowerCase();
	if (!marker || !name || !ALERT_NAMES.has(name)) return null;
	const body = lines.slice(1).map(stripQuoteMarker);
	const out = [`:::${name}`, ...body, ':::'].join('\n');
	return trailingNewline ? `${out}\n` : out;
}

/**
 * Rewrite every GitHub-alert blockquote in `text` into an equivalent `:::name`
 * container. A marker line counts only at the start of its blockquote (GitHub's
 * rule — a mid-quote `[!TYPE]` stays literal); every other line is emitted
 * verbatim, so mixed content and plain blockquotes are preserved.
 */
export function convertGithubAlerts(text: string): AlertConversion {
	const lines = text.split('\n');
	const out: string[] = [];
	let changed = false;
	let i = 0;

	while (i < lines.length) {
		const marker = MARKER.exec(lines[i]);
		const name = marker?.[2]?.toLowerCase();
		const opensBlockquote = i === 0 || !QUOTE_LINE.test(lines[i - 1]);

		if (marker && name && ALERT_NAMES.has(name) && opensBlockquote) {
			const body: string[] = [];
			let j = i + 1;
			while (j < lines.length && QUOTE_LINE.test(lines[j])) {
				body.push(stripQuoteMarker(lines[j]));
				j++;
			}
			out.push(`:::${name}`, ...body, ':::');
			changed = true;
			i = j;
		} else {
			out.push(lines[i]);
			i++;
		}
	}

	return { converted: out.join('\n'), changed };
}

/** Whether `text` contains at least one convertible GitHub alert. */
export function hasGithubAlert(text: string): boolean {
	const lines = text.split('\n');
	return lines.some((line, i) => {
		const m = MARKER.exec(line);
		if (!m || !ALERT_NAMES.has((m[2] ?? '').toLowerCase())) return false;
		return i === 0 || !QUOTE_LINE.test(lines[i - 1]);
	});
}
