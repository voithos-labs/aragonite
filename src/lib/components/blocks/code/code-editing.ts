/** Pair tables, leading-whitespace extraction, and stateless predicates for bracket/quote auto-pairing. */

// ── Pair tables ─────────────────────────────────────────────────────────────

export const BRACKET_PAIRS: Readonly<Record<string, string>> = {
	'(': ')',
	'[': ']',
	'{': '}'
};

/**
 * Backtick is safe to pair: terminating a fence needs a bare-line run of
 * ≥ fenceLength at column 0, which a single typed `` ` `` can never be.
 */
export const QUOTE_CHARS: ReadonlySet<string> = new Set(["'", '"', '`']);

/**
 * Opening brackets are deliberately excluded: typing `(` when the next char
 * is `(` should produce nesting, not a skip.
 */
export const SKIP_CLOSE_CHARS: ReadonlySet<string> = new Set([
	...Object.values(BRACKET_PAIRS),
	...QUOTE_CHARS
]);

const IDENTIFIER_RE = /[\w$]/;

export function getCloserFor(opener: string): string | null {
	if (opener in BRACKET_PAIRS) return BRACKET_PAIRS[opener];
	if (QUOTE_CHARS.has(opener)) return opener;
	return null;
}

// ── Leading-whitespace extraction (auto-indent) ─────────────────────────────

export function getLineLeadingWhitespace(text: string, offset: number): string {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const lineStart = clamped === 0 ? 0 : text.lastIndexOf('\n', clamped - 1) + 1;
	let end = lineStart;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
	return text.slice(lineStart, end);
}

// ── Auto-pair decisions ─────────────────────────────────────────────────────

/**
 * Brackets refuse to pair before an identifier (wrapping existing code, `(foo`);
 * quotes also refuse after one (the `don't` case).
 */
export function shouldAutoClose(text: string, offset: number, opener: string): boolean {
	const next = text[offset];
	if (next !== undefined && IDENTIFIER_RE.test(next)) return false;
	if (QUOTE_CHARS.has(opener)) {
		const prev = text[offset - 1];
		if (prev !== undefined && IDENTIFIER_RE.test(prev)) return false;
	}
	return true;
}

/** Overtype: skip past an existing closer instead of inserting a duplicate. */
export function shouldSkipClose(text: string, offset: number, typed: string): boolean {
	if (!SKIP_CLOSE_CHARS.has(typed)) return false;
	return text[offset] === typed;
}

// ── Empty-pair detection (electric indent, backspace pair-delete) ───────────

/** True at `(|)`, `[|]`, `{|}`, `"|"`, `'|'`, `` `|` ``. Drives Backspace pair-delete. */
export function isBetweenEmptyPair(text: string, offset: number): boolean {
	if (offset <= 0 || offset >= text.length) return false;
	const prev = text[offset - 1];
	const next = text[offset];
	return getCloserFor(prev) === next;
}

/**
 * Bracket-only variant for Enter's electric indent: `{|}` expands to a
 * three-line block, `"|"` does not (multi-line string literals are rare).
 */
export function isBetweenEmptyBracketPair(text: string, offset: number): boolean {
	if (offset <= 0 || offset >= text.length) return false;
	const prev = text[offset - 1];
	const next = text[offset];
	return prev in BRACKET_PAIRS && BRACKET_PAIRS[prev] === next;
}
