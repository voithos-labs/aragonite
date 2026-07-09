/**
 * Pure fence grammar for the `:::name` directive primitive: opener/closer
 * recognition and lossless serialization. Framework-free and CST-free — the
 * parser and serializer wire these into the tree in later dispatches.
 *
 * Byte round-trip is the master invariant: `serializeDirective` reproduces the
 * opener colons, the verbatim `info` (leading separator included), the body
 * wrap, and a matched closer exactly.
 */

// ── Opener / closer ───────────────────────────────────────────────────────────

export type DirectiveTier = 'container' | 'leaf' | 'text';

export interface DirectiveFence {
	/** `matchDirectiveOpener` returns only 'container' | 'leaf'. */
	tier: DirectiveTier;
	/** 2 = leaf, ≥3 = container. */
	colonCount: number;
	/** `/^\w+/` after the colon run. */
	name: string;
	/** Verbatim remainder of the line incl. its leading separator; no trailing newline. */
	info: string;
}

const OPENER = /^(:{2,})(\w+)(.*)$/;

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

export function isDirectiveCloser(lineText: string, openColonCount: number): boolean {
	return new RegExp(`^:{${openColonCount},}$`).test(lineText);
}

// ── Serialize ─────────────────────────────────────────────────────────────────

export function serializeDirective(parts: {
	colonCount: number;
	name: string;
	info: string;
	innerPrefix: string;
	body: string;
	innerSuffix: string;
}): string {
	const fence = ':'.repeat(parts.colonCount);
	return `${fence}${parts.name}${parts.info}\n${parts.innerPrefix}${parts.body}${parts.innerSuffix}${fence}\n`;
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
