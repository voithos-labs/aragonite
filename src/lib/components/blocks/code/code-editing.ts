/**
 * Pure editing helpers for code-block conveniences — auto-indent on Enter,
 * auto-close bracket / quote pairs on insertText, and stateless skip-over
 * when the typed closer already sits under the cursor.
 *
 * No DOM, no Svelte, no editor state. Every function takes a flat string
 * and an offset so the orchestration layer (CodeBlock.svelte) can trivially
 * sequence them into its existing `textContent === trimTrailingLineEnding(raw)`
 * pipeline.
 */

// ── Pair tables ─────────────────────────────────────────────────────────────

/** Bracket openers paired with their closers. */
export const BRACKET_PAIRS: Readonly<Record<string, string>> = {
	'(': ')',
	'[': ']',
	'{': '}'
};

/**
 * Quote characters that auto-pair to themselves. Backtick is included: even
 * in a backtick-fenced code block, a single typed `` ` `` cannot terminate
 * the fence (requires a bare-line run of ≥ fenceLength at column 0), so the
 * usual "insert two backticks around the cursor" behavior is safe.
 */
export const QUOTE_CHARS: ReadonlySet<string> = new Set(["'", '"', '`']);

/**
 * Characters eligible for stateless skip-over — every closer plus every
 * quote. Opening brackets are deliberately excluded: typing `(` when the
 * next char is `(` should produce nesting, not a skip.
 */
export const SKIP_CLOSE_CHARS: ReadonlySet<string> = new Set([')', ']', '}', "'", '"', '`']);

/** Identifier / word characters for adjacency heuristics. */
const IDENTIFIER_RE = /[\w$]/;

/**
 * Return the closer that should be inserted for a typed opener, or null if
 * the character is not auto-paired.
 */
export function getCloserFor(opener: string): string | null {
	if (opener in BRACKET_PAIRS) return BRACKET_PAIRS[opener];
	if (QUOTE_CHARS.has(opener)) return opener;
	return null;
}

// ── Leading-whitespace extraction (auto-indent) ─────────────────────────────

/**
 * Leading horizontal whitespace (spaces + tabs) of the line containing
 * `offset`. Used by Enter auto-indent to replicate the previous line's
 * indent on the new line. Returns an empty string for un-indented lines.
 */
export function getLineLeadingWhitespace(text: string, offset: number): string {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const lineStart = clamped === 0 ? 0 : text.lastIndexOf('\n', clamped - 1) + 1;
	let end = lineStart;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
	return text.slice(lineStart, end);
}

// ── Auto-pair decisions ─────────────────────────────────────────────────────

/**
 * Decide whether typing `opener` at `offset` should produce the auto-paired
 * closer in addition to the typed character.
 *
 * - Brackets pair unless the next char is an identifier char (the user is
 *   wrapping existing code like `(foo` where auto-pairing would be annoying).
 * - Quotes additionally refuse to pair when the *previous* char is an
 *   identifier, which handles the `don't` case: typing `'` between two
 *   word chars should just insert the apostrophe.
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

/**
 * Decide whether typing `typed` at `offset` should skip past an existing
 * matching character already at that position instead of inserting a
 * duplicate. Stateless — triggers whenever the typed char is a closer or
 * quote and the next char matches it. This is the overtype behavior users
 * expect from `)` after auto-pairing and from `"` closing a freshly opened
 * string.
 */
export function shouldSkipClose(text: string, offset: number, typed: string): boolean {
	if (!SKIP_CLOSE_CHARS.has(typed)) return false;
	return text[offset] === typed;
}

// ── Empty-pair detection (electric indent, backspace pair-delete) ───────────

/**
 * True when the cursor at `offset` sits immediately between an opener and
 * its own closer — `(|)`, `[|]`, `{|}`, `"|"`, `'|'`, `` `|` ``.
 * Drives pair-delete on Backspace (removes both halves atomically).
 */
export function isBetweenEmptyPair(text: string, offset: number): boolean {
	if (offset <= 0 || offset >= text.length) return false;
	const prev = text[offset - 1];
	const next = text[offset];
	return getCloserFor(prev) === next;
}

/**
 * True when the cursor sits between an empty *bracket* pair only — excludes
 * quote pairs. Used by Enter's electric-indent path: `{|}` expands into a
 * three-line block with extra indent, but `"|"` stays inline because
 * multi-line string literals are not the common case.
 */
export function isBetweenEmptyBracketPair(text: string, offset: number): boolean {
	if (offset <= 0 || offset >= text.length) return false;
	const prev = text[offset - 1];
	const next = text[offset];
	return prev in BRACKET_PAIRS && BRACKET_PAIRS[prev] === next;
}
