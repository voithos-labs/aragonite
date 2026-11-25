/**
 * Shared vocabulary for the admonitions plugin, in its own module so the plugin value and the
 * component agree on names without a circular import.
 */

/** In cycle order; index 0 is the fallback for a name that is none of these. */
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

/** A box's data: the name after its `:::`, which the cycle rewrites. */
export interface AdmonitionData {
	name: string;
}

/** An alert's data: its type as typed (`NOTE`, `Note`), which its head line writes back. */
export interface AlertData {
	alertType: string;
}
