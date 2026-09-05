/**
 * Shared vocabulary for the admonitions plugin, in its own module so registration
 * and the component agree on names without a circular import.
 */
export const ADMONITION = 'admonition';
export const ADMONITION_TITLE = 'admonition-title';
export const GITHUB_ALERT = 'githubAlert';

/** In cycle order; index 0 is the fallback when a node carries no name in its metadata. */
export const ADMONITION_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AdmonitionName = (typeof ADMONITION_KINDS)[number];

function isAdmonitionName(value: unknown): value is AdmonitionName {
	return typeof value === 'string' && (ADMONITION_KINDS as readonly string[]).includes(value);
}

export function coerceAdmonitionName(value: unknown): AdmonitionName {
	return isAdmonitionName(value) ? value : ADMONITION_KINDS[0];
}

export function capitalize(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Every field flows back into the opener bytes through `rebuildRaw`. Primitive-valued
 *  only: the undo clone shallow-copies metadata. */
export interface AdmonitionMetadata {
	name: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

/** The marker's type as typed (`NOTE`, `Note`), stored verbatim so `rebuildRaw` re-emits
 *  the source casing; readers lowercase through `coerceAdmonitionName` for display. */
export interface GithubAlertMetadata {
	alertType: string;
}
