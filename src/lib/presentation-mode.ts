/**
 * The presentation-mode contract. `source` is the editing default (always-visible styled
 * source); `reading` hides markers, renders widgets, and makes the surface inert;
 * `preview-block` hides markers on every block but the one holding the caret;
 * `preview-inline` narrows that reveal to the caret-touched construct
 * (`components/blocks/text/construct-reveal.ts`). Every door reports the EFFECTIVE mode.
 */

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline';

/** The two live-preview rungs share their marker-hiding CSS families and the
 *  focus-tracking `data-focused` attribute. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/**
 * The read-only gate the dispatch seams key off. Structural parameter type so the
 * schema/selection layers need no editor-keys import; an `undefined` getter (test
 * doubles, unwired surfaces) means not reading.
 */
export function isReadingMode(getMode: (() => PresentationMode) | undefined): boolean {
	return getMode?.() === 'reading';
}
