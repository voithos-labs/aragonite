/**
 * Inline pipeline stage 0: backslash-escape normalization. Identity pass;
 * the seat exists so later stages don't need call-site changes when filled.
 */

export interface PreEscapeResult {
	modified: boolean;
}

export function preEscapeInline(_raw: string, _start: number, _end: number): PreEscapeResult {
	return { modified: false };
}
