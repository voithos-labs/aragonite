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
 * Two converters, one extent authority. `convertAlertBlockquoteRaw` is handed the
 * extent the parser already decided; `convertGithubAlerts` runs the parser's own
 * `blockquoteExtent` over its line window, so CommonMark §5.1 lazy continuation —
 * stateful, absorbing a line only while a paragraph is open — lands identically on
 * both. `test/plugins/admonitions/converter-parity.test.ts` is the differential
 * that keeps it that way. Reach for the parse-scoped wrapper in
 * `convert-document.ts` on a whole document; the stream scanner is the fallback for
 * callers holding nothing but a string, and unlike the wrapper it is not fence-safe.
 */
import { blockquoteExtent, escalatedColonCount, splitLines, type ParsedLine } from '$lib/plugin';
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
 * Emit one alert's `:::name` block from the quote lines it spans. Every emitted
 * line keeps the ending of the source line it replaces, and the synthesized
 * closer inherits the last one — so a source ending without a newline emits none,
 * and a CRLF document stays CRLF. The closer is one line longer than the source,
 * which is what the fallback covers.
 */
function emitDirective(name: string, source: ParsedLine[]): string {
	const body = source.slice(1).map((line) => stripQuoteMarker(line.text));
	const wrapped = wrapAsDirective(name, body);
	const fallback = source.find((line) => line.lineEnding !== '')?.lineEnding ?? '\n';
	const closerEnding = source[source.length - 1].lineEnding;
	let out = '';
	for (let i = 0; i < wrapped.length; i++) {
		const isCloser = i === wrapped.length - 1;
		out += wrapped[i] + (isCloser ? closerEnding : source[i].lineEnding || fallback);
	}
	return out;
}

/**
 * Convert one blockquote's exact raw bytes into `:::name` source, or null when
 * it is not a GitHub alert. GitHub only honors the `[!TYPE]` marker on the
 * blockquote's FIRST line; everything after — including lazy-continuation lines
 * and later literal `[!TYPE]` markers — is body, quote markers stripped.
 */
export function convertAlertBlockquoteRaw(raw: string): string | null {
	const lines = splitLines(raw);
	if (lines.length === 0) return null;
	const typed = matchAlertMarker(lines[0].text);
	return typed ? emitDirective(typed.toLowerCase(), lines) : null;
}

/**
 * Rewrite every GitHub-alert blockquote in `text` into an equivalent `:::name`
 * container. A marker line counts only at the start of its blockquote (GitHub's
 * rule — a mid-quote `[!TYPE]` stays literal); every other line is emitted
 * verbatim, so mixed content and plain blockquotes are preserved.
 */
export function convertGithubAlerts(text: string): AlertConversion {
	const lines = splitLines(text);
	let converted = '';
	let changed = false;
	let i = 0;

	while (i < lines.length) {
		const typed = matchAlertMarker(lines[i].text);
		if (typed && startsBlockquote(lines, i)) {
			const { nextIndex } = blockquoteExtent(lines, i, lines.length);
			converted += emitDirective(typed.toLowerCase(), lines.slice(i, nextIndex));
			changed = true;
			i = nextIndex;
		} else {
			converted += lines[i].raw;
			i++;
		}
	}

	return { converted, changed };
}

/** Whether `text` contains at least one convertible GitHub alert. */
export function hasGithubAlert(text: string): boolean {
	const lines = splitLines(text);
	return lines.some(
		(line, i) => matchAlertMarker(line.text) !== null && startsBlockquote(lines, i)
	);
}

/** Whether the line at `index` opens its blockquote rather than continuing one. */
function startsBlockquote(lines: ParsedLine[], index: number): boolean {
	return index === 0 || !QUOTE_OPEN.test(lines[index - 1].text);
}
