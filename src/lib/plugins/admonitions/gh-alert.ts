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
 * exactly one place.
 *
 * Two converters, one grammar, and a fork worth knowing about.
 * `convertAlertBlockquoteRaw` is handed an extent the parser already decided;
 * `convertGithubAlerts` scans for its own, one line at a time. No line test can
 * reproduce the parser there — CommonMark lazy continuation is stateful, absorbing
 * a line only while a paragraph is open — so the two disagree on an over-indented
 * `>` line following a body line that closed the paragraph, and on a plain lazy
 * line. `test/plugins/admonitions/converter-parity.test.ts` pins both where they
 * agree and where they fork. Reach for the parse-scoped wrapper in
 * `convert-document.ts` on a whole document; the stream scanner is the fallback for
 * callers holding nothing but a string.
 */
import { escalatedColonCount } from '$lib/plugin';
import { ADMONITION_KINDS } from './kinds';

const ALERT_NAMES = new Set<string>(ADMONITION_KINDS);

const CANONICAL_COLONS = 3;

/**
 * The `:::name` … `:::` wrapper for one alert's stripped body lines, with the
 * fence lengthened past any colon run the body reproduces — an unescalated bare
 * `:::` body line would read as the container's own closer and push the rest of
 * the alert out of it. This transform writes its output into the document, so
 * the damage would be persisted, not merely live.
 */
function wrapAsDirective(name: string, body: string[]): string[] {
	const colons = ':'.repeat(escalatedColonCount(body.join('\n'), CANONICAL_COLONS));
	return [`${colons}${name}`, ...body, colons];
}

/**
 * `> [!NOTE]` alone on the line (case-insensitive type, optional space after `>`).
 * The indent is capped at CommonMark's block indent: 4+ spaces or a tab makes the
 * line indented code, not a blockquote, so the extent scan would claim nothing and
 * the opener would consume no line.
 */
const MARKER = /^ {0,3}>[ \t]*\[!([A-Za-z]+)\][ \t]*$/;

/**
 * A `>` line that opens a blockquote, capped at CommonMark's 0–3 space block
 * indent like the built-in `matchBlockquote`: past that the line is indented code
 * and opens nothing. Answers "was the previous line already inside a quote", which
 * is what makes a marker count only at its quote's first line.
 */
const QUOTE_OPEN = /^ {0,3}>/;

/**
 * A line the stream converter's body scan still claims. Uncapped where the other
 * two gates are capped, because the cap means the opposite thing here: at the strip
 * it declines and leaves the bytes alone, but at a scan it STOPS, and a stop ejects
 * the rest of the alert. A tab-indented continuation emitted a body-less
 * `:::note` / `:::` pair with the body outside it, where both other converters kept
 * it in. Claiming the line and letting `stripQuoteMarker` decline reproduces the
 * parser's own handling of it.
 */
const QUOTED_BODY_LINE = /^[ \t]*>/;

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

/**
 * Strip one leading `>` and at most one following space/tab (GFM blockquote
 * marker). Indent is capped at CommonMark's 0–3 spaces, matching the built-in
 * `stripBlockquotePrefix`: past that the line is indented code, and its `>` is
 * literal text a strip would silently promote to a quote marker on rebuild.
 */
export function stripQuoteMarker(line: string): string {
	const m = /^ {0,3}>[ \t]?/.exec(line);
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
	const out = wrapAsDirective(typed.toLowerCase(), body).join('\n');
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

		if (typed && startsBlockquote(lines, i)) {
			const body: string[] = [];
			let j = i + 1;
			while (j < lines.length && QUOTED_BODY_LINE.test(lines[j])) {
				body.push(stripQuoteMarker(lines[j]));
				j++;
			}
			out.push(...wrapAsDirective(typed.toLowerCase(), body));
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
	return lines.some((line, i) => matchAlertMarker(line) !== null && startsBlockquote(lines, i));
}

/** Whether the line at `index` opens its blockquote rather than continuing one. */
function startsBlockquote(lines: string[], index: number): boolean {
	return index === 0 || !QUOTE_OPEN.test(lines[index - 1]);
}
