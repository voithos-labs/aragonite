/**
 * The GitHub-alert marker grammar — the single home for `> [!TYPE]` recognition —
 * plus the `source → source` transform that rewrites alert blockquotes into
 * `:::name` directive source.
 *
 *   > [!NOTE]        :::note
 *   > Body line   →  Body line
 *                    :::
 *
 * `matchAlertMarker` and `stripQuoteMarker` are the grammar the native
 * `githubAlert` opener (github-alert-kind.ts) reuses, so the marker rule lives in
 * exactly one place. The transform stays free of any editor import so it
 * unit-tests in isolation; the document-scoped wrapper (which needs `parse` to
 * skip code blocks) lives in `convert-document.ts`.
 */
import { ADMONITION_KINDS } from './kinds';

const ALERT_NAMES = new Set<string>(ADMONITION_KINDS);

/**
 * `> [!NOTE]` alone on the line (case-insensitive type, optional space after `>`).
 * The indent is capped at CommonMark's block indent: 4+ spaces or a tab makes the
 * line indented code, not a blockquote, so the extent scan would claim nothing and
 * the opener would consume no line.
 */
const MARKER = /^ {0,3}>[ \t]*\[!([A-Za-z]+)\][ \t]*$/;

/**
 * A `>`-prefixed line, for the transform's body scan and blockquote-start test.
 * Its indent stays uncapped where MARKER's is capped: this one gates no opener, so
 * over-acceptance can only mis-scope a `source → source` rewrite. `stripQuoteMarker`
 * is uncapped too but does run on the opener path, where over-acceptance mis-scopes
 * the body strip — both are ledgered in `docs/issues.md`.
 */
const QUOTE_LINE = /^[ \t]*>/;

/**
 * The alert type as it was typed (`NOTE`, `Note`, `warning`) when `line` is
 * exactly a `> [!TYPE]` marker for a known type, else null. Callers that need the
 * canonical name lowercase the result; the opener stores it verbatim so the source
 * casing survives a rebuild.
 */
export function matchAlertMarker(line: string): string | null {
	const typed = MARKER.exec(line)?.[1];
	return typed && ALERT_NAMES.has(typed.toLowerCase()) ? typed : null;
}

/** Strip one leading `>` and at most one following space/tab (GFM blockquote marker). */
export function stripQuoteMarker(line: string): string {
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
	const typed = matchAlertMarker(lines[0]);
	if (!typed) return null;
	const body = lines.slice(1).map(stripQuoteMarker);
	const out = [`:::${typed.toLowerCase()}`, ...body, ':::'].join('\n');
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
		const typed = matchAlertMarker(lines[i]);
		const opensBlockquote = i === 0 || !QUOTE_LINE.test(lines[i - 1]);

		if (typed && opensBlockquote) {
			const body: string[] = [];
			let j = i + 1;
			while (j < lines.length && QUOTE_LINE.test(lines[j])) {
				body.push(stripQuoteMarker(lines[j]));
				j++;
			}
			out.push(`:::${typed.toLowerCase()}`, ...body, ':::');
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
		if (!matchAlertMarker(line)) return false;
		return i === 0 || !QUOTE_LINE.test(lines[i - 1]);
	});
}
