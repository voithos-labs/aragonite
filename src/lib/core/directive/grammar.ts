/**
 * Pure fence grammar for the `:::name` directive primitive: opener/closer
 * recognition and lossless serialization. Framework-free and CST-free — the
 * parser and serializer consume these to build and re-emit the tree.
 *
 * Byte round-trip is the master invariant: `serializeDirective` reproduces the
 * opener colons, the verbatim `info` (leading separator included), the body
 * wrap, and a matched closer exactly.
 */

// ── Opener / closer ───────────────────────────────────────────────────────────

export type DirectiveTier = 'container' | 'leaf' | 'text';

export interface DirectiveFence {
	tier: Exclude<DirectiveTier, 'text'>;
	/** 2 = leaf, ≥3 = container. */
	colonCount: number;
	/** Charset `[A-Za-z][A-Za-z0-9-]*`: letter start, then letters/digits/hyphens (no underscore). */
	name: string;
	/** Verbatim remainder of the line incl. its leading separator; no trailing newline. */
	info: string;
}

const OPENER = /^(:{2,})([A-Za-z][A-Za-z0-9-]*)(.*)$/;

export function matchDirectiveOpener(lineText: string): DirectiveFence | null {
	const match = OPENER.exec(lineText);
	if (!match) return null;
	const colonCount = match[1].length;
	return {
		tier: colonCount === 2 ? 'leaf' : 'container',
		colonCount,
		name: match[2],
		info: match[3]
	};
}

const COLON = 0x3a;

// Char-scan, not `new RegExp` per call: the closer test runs inside the parser's
// per-line loop, so it must not allocate. A closer is a colon run ≥ the opener's
// count with nothing after it.
export function isDirectiveCloser(lineText: string, openColonCount: number): boolean {
	let count = 0;
	while (count < lineText.length && lineText.charCodeAt(count) === COLON) count++;
	return count >= openColonCount && count === lineText.length;
}

/**
 * The colon count a fence needs to wrap `body` — one past the body's longest
 * whole-line colon run, never below `minimum`. The write-side inverse of
 * `isDirectiveCloser`: without it, a body line reproducing the terminator reads
 * as the container's own closer and ejects everything below it on reparse.
 */
export function escalatedColonCount(body: string, minimum: number): number {
	let required = minimum;
	for (const line of body.split('\n')) {
		// Splitting on `\n` leaves a CRLF body's `\r` on each segment's tail; a
		// closer line's text excludes it, so the run test must too.
		const text = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (text.length >= required && isDirectiveCloser(text, required)) required = text.length + 1;
	}
	return required;
}

// ── Serialize ─────────────────────────────────────────────────────────────────

export function serializeDirective(parts: {
	colonCount: number;
	name: string;
	info: string;
	innerPrefix: string;
	body: string;
	innerSuffix: string;
	/** Closer colon run; defaults to `colonCount`. A nested `::::` closer widens past its opener. */
	closerColonCount?: number;
	/** Whether the closer ends with a newline; defaults to true. False for a document-final directive. */
	closerNewline?: boolean;
	/** Authored line ending for the synthesized opener line; defaults to `\n`. Threaded so a CRLF-authored directive rebuilds CRLF-safe (the body carries its own bytes). */
	lineEnding?: string;
	/** Authored line ending for the closer line; defaults to `lineEnding`. A mixed-ending directive (LF opener, CRLF closer) keeps each chrome line's own bytes. */
	closerLineEnding?: string;
}): string {
	const lineEnding = parts.lineEnding ?? '\n';
	const inner = `${parts.innerPrefix}${parts.body}${parts.innerSuffix}`;
	// Re-derived from the body on every emit rather than latched into metadata, so
	// two emits over the same state always agree (G1.13). `colonCount` is a floor,
	// not a target: the fence narrows back when the colliding line goes away, though
	// only within the node's life, since a reparse reads the widened opener as the
	// new floor.
	const colonCount = escalatedColonCount(inner, parts.colonCount);
	const opener = ':'.repeat(colonCount);
	const closer = ':'.repeat(Math.max(colonCount, parts.closerColonCount ?? colonCount));
	const closerEnd = (parts.closerNewline ?? true) ? (parts.closerLineEnding ?? lineEnding) : '';
	return `${opener}${parts.name}${parts.info}${lineEnding}${inner}${closer}${closerEnd}`;
}

// ── Attributes ────────────────────────────────────────────────────────────────

export interface DirectiveAttributes {
	label?: string;
	id?: string;
	classes: string[];
	properties: Record<string, string>;
}

const LABEL = /^\s*\[([^\]]*)\]/;
const BRACES = /\{([^}]*)\}/;
// One attribute token: a run of non-space chars with quoted segments folded in,
// so `title="a b"` stays whole instead of splitting on its inner space.
const ATTR_TOKEN = /(?:[^\s"]+|"[^"]*")+/g;

/**
 * Opt-in `info → structure` reader: pulls a leading `[label]` and a `{#id .class
 * key=val}` block out of the opener info. Bare or unmatched info yields an empty
 * structure (the callout-title path). One-way only — there is no inverse
 * serializer; the verbatim `info` remains the round-trip source of truth.
 */
export function parseDirectiveAttributes(info: string): DirectiveAttributes {
	const attributes: DirectiveAttributes = { classes: [], properties: {} };

	let rest = info;
	const labelMatch = LABEL.exec(info);
	if (labelMatch) {
		attributes.label = labelMatch[1];
		rest = info.slice(labelMatch[0].length);
	}

	const braceMatch = BRACES.exec(rest);
	if (!braceMatch) return attributes;

	for (const token of braceMatch[1].match(ATTR_TOKEN) ?? []) {
		if (token.startsWith('#')) {
			attributes.id = token.slice(1);
		} else if (token.startsWith('.')) {
			attributes.classes.push(token.slice(1));
		} else {
			const eq = token.indexOf('=');
			if (eq > 0) {
				const value = token.slice(eq + 1);
				attributes.properties[token.slice(0, eq)] = unquote(value);
			}
		}
	}
	return attributes;
}

function unquote(value: string): string {
	return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
