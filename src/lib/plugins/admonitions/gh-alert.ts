/**
 * The single home for `> [!TYPE]` recognition, reused by the native `githubAlert` opener.
 * Both converters run the parser's own extent authority so CommonMark §5.1 lazy
 * continuation lands identically. On a whole document prefer the wrapper in
 * `convert-document.ts`: the stream scanner here is not fence-safe.
 */
import { blockquoteExtent, escalatedColonCount, splitLines, type ParsedLine } from '$lib/plugin';
import { ADMONITION_KINDS } from './kinds';

const ALERT_NAMES = new Set<string>(ADMONITION_KINDS);

const CANONICAL_COLONS = 3;

/** Fence lengthened past any colon run in the body, which would otherwise read as the
 *  container's own closer once this output is written into the document. */
function wrapAsDirective(name: string, body: string[]): string[] {
	const colons = ':'.repeat(escalatedColonCount(body.join('\n'), CANONICAL_COLONS));
	return [`${colons}${name}`, ...body, colons];
}

/** Every `>` pattern here caps indent at CommonMark's 0–3 spaces: past that the line is
 *  indented code, and claiming it would promote a literal `>` to a marker on rebuild. */
const MARKER = /^ {0,3}>[ \t]*\[!([A-Za-z]+)\][ \t]*$/;

const QUOTE_OPEN = /^ {0,3}>/;

/** The type as typed (`NOTE`, `Note`); the opener stores it verbatim so source casing
 *  survives a rebuild. */
export function matchAlertMarker(line: string): string | null {
	const typed = MARKER.exec(line)?.[1];
	return typed && ALERT_NAMES.has(typed.toLowerCase()) ? typed : null;
}

export function stripQuoteMarker(line: string): string {
	const m = /^ {0,3}>[ \t]?/.exec(line);
	return m ? line.slice(m[0].length) : line;
}

export interface AlertConversion {
	converted: string;
	changed: boolean;
}

/**
 * Each emitted line keeps its source line ending so CRLF survives; the closer runs one line past
 * the source, which is what the fallback covers. The body converts in the same pass: stripping a
 * quote level promotes a nested `> [!TIP]` to a top-level marker a later pass would convert again.
 */
function emitDirective(name: string, source: ParsedLine[]): string {
	const fallback = source.find((line) => line.lineEnding !== '')?.lineEnding ?? '\n';
	const stripped = source
		.slice(1)
		.map((line) => stripQuoteMarker(line.text) + (line.lineEnding || fallback))
		.join('');
	const body = splitLines(convertGithubAlerts(stripped).converted);
	const wrapped = wrapAsDirective(
		name,
		body.map((line) => line.text)
	);
	let out = `${wrapped[0]}${source[0].lineEnding || fallback}`;
	for (let i = 0; i < body.length; i++) out += body[i].text + (body[i].lineEnding || fallback);
	return out + wrapped[wrapped.length - 1] + source[source.length - 1].lineEnding;
}

/** GitHub honors `[!TYPE]` only on the blockquote's first line; everything after,
 *  lazy-continuation lines and later literal markers alike, is body. */
export function convertAlertBlockquoteRaw(raw: string): string | null {
	const lines = splitLines(raw);
	if (lines.length === 0) return null;
	const typed = matchAlertMarker(lines[0].text);
	return typed ? emitDirective(typed.toLowerCase(), lines) : null;
}

export function convertGithubAlerts(text: string): AlertConversion {
	const lines = splitLines(text);
	let converted = '';
	let changed = false;
	let i = 0;

	while (i < lines.length) {
		const typed = matchAlertMarker(lines[i].text);
		if (typed && startsBlockquote(lines, i)) {
			const { nextIndex } = blockquoteExtent(lines, i, lines.length);
			// A marker line always opens a quote, so the extent claims at least this line;
			// floored anyway because a loosened indent cap would hang this loop.
			if (nextIndex > i) {
				converted += emitDirective(typed.toLowerCase(), lines.slice(i, nextIndex));
				changed = true;
				i = nextIndex;
				continue;
			}
		}
		converted += lines[i].raw;
		i++;
	}

	return { converted, changed };
}

export function hasGithubAlert(text: string): boolean {
	const lines = splitLines(text);
	return lines.some(
		(line, i) => matchAlertMarker(line.text) !== null && startsBlockquote(lines, i)
	);
}

function startsBlockquote(lines: ParsedLine[], index: number): boolean {
	return index === 0 || !QUOTE_OPEN.test(lines[index - 1].text);
}
