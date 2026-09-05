/**
 * The presentation-mode contract. `source` is the editing default (always-visible styled
 * source); `reading` hides markers and makes the surface inert; `preview-block` reveals the
 * caret's block and `preview-inline` narrows that reveal to the caret-touched construct
 * (`components/blocks/text/construct-reveal.ts`); `live` hides markers with no reveal at all,
 * while staying editable. Every door reports the EFFECTIVE mode.
 */

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live';

/** Keyed by the union, so a rung added to it fails `npm run check` here rather than falling
 *  silently through {@link asPresentationMode}'s door. */
const MODES: Record<PresentationMode, true> = {
	source: true,
	reading: true,
	'preview-block': true,
	'preview-inline': true,
	live: true
};

/**
 * A mode read off the DOM or handed in untyped, narrowed to the contract. The marker-hiding CSS
 * families match known values only, so an unrecognized one must read as the editing default here or
 * the stylesheet and the caret walk disagree about the same block.
 */
export function asPresentationMode(value: string | null | undefined): PresentationMode {
	return value != null && Object.hasOwn(MODES, value) ? (value as PresentationMode) : 'source';
}

/** Membership for the marker-hiding CSS families and the `data-list-marker` hook that
 *  feeds them: styled source is the one mode that paints Markdown syntax. */
export function hidesMarkers(mode: PresentationMode): boolean {
	return mode !== 'source';
}

/** The reveal-on-focus rungs, which alone need the `data-focused` attribute — live hides
 *  markers (see `hidesMarkers`) but never reveals them, so it is deliberately not one. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/**
 * Whether the mode paints a marker in the block the caret is in: styled source always, and the
 * preview rungs by revealing that block. The question every seam writing at the caret asks, since
 * a rewrite may only drop bytes the reader never saw (live-mode.md § 2).
 */
export function paintsFocusedMarkers(mode: PresentationMode): boolean {
	return !hidesMarkers(mode) || isPreviewMode(mode);
}

/**
 * The read-only gate the dispatch seams key off. Structural parameter type so the
 * schema/selection layers need no editor-keys import; an `undefined` getter (test
 * doubles, unwired surfaces) means not reading.
 */
export function isReadingMode(getMode: (() => PresentationMode) | undefined): boolean {
	return getMode?.() === 'reading';
}
