/**
 * Shared vocabulary for the admonitions plugin: the two block kinds it mints and
 * the five directive names that resolve to the single admonition kind. Kept in
 * one module so the registration module and the component agree on names without
 * a circular import.
 */
import { declarePluginKind, declaredPluginKind, type PluginBlockKind } from '$lib/plugin';

export const ADMONITION = 'admonition';
export const ADMONITION_TITLE = 'admonition-title';
/** GitHub's `> [!NOTE]` alert: a first-class container kind, distinct from the
 *  `:::name` directive admonition so kind stability and rebuildRaw stay per-kind. */
export const GITHUB_ALERT = 'githubAlert';

/** The five directive names, in cycle order — index 0 is the default fallback
 *  when a node carries no name in its metadata. */
export const ADMONITION_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AdmonitionName = (typeof ADMONITION_KINDS)[number];

function isAdmonitionName(value: unknown): value is AdmonitionName {
	return typeof value === 'string' && (ADMONITION_KINDS as readonly string[]).includes(value);
}

/** A valid admonition name, or the default (index 0) for anything else. */
export function coerceAdmonitionName(value: unknown): AdmonitionName {
	return isAdmonitionName(value) ? value : ADMONITION_KINDS[0];
}

/** Capitalize a kind name for the box's aria-label (e.g. "Tip admonition"). */
export function capitalize(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Per-node metadata the container carries. Every field flows back into the
 * opener bytes through `rebuildRaw`, so an edit (title, kind switch) survives a
 * round-trip. Primitive-valued only — the undo clone shallow-copies metadata.
 */
export interface AdmonitionMetadata {
	name: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

/**
 * A GitHub alert's per-node metadata: the alert type as it was typed in the marker
 * (`NOTE`, `Note`, `warning`). Stored verbatim so `rebuildRaw` re-emits the source
 * casing byte-faithfully; readers normalize with `coerceAdmonitionName(alertType
 * .toLowerCase())` for the badge. Primitive-valued — the undo clone shallow-copies.
 */
export interface GithubAlertMetadata {
	alertType: string;
}

/** Declare both kinds once; safe to call repeatedly (re-import / HMR). */
export function declareAdmonitionKinds(): { admonition: PluginBlockKind; title: PluginBlockKind } {
	return {
		admonition: declarePluginKind(ADMONITION),
		title: declarePluginKind(ADMONITION_TITLE)
	};
}

export function admonitionTitleKind(): PluginBlockKind {
	return declaredPluginKind(ADMONITION_TITLE);
}
