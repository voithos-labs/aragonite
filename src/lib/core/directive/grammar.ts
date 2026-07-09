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
