/**
 * The presentation-mode contract. `source` is the editing default (always-visible
 * styled source, byte-identical to pre-mode behavior); `reading` hides markers,
 * renders widgets, and makes the surface inert; `preview-block` is a live editing
 * mode that hides markers on every block except the one holding the caret (the
 * focused block renders exactly as `source` does); `preview-inline` narrows the
 * reveal to inline granularity — within the focused block, each construct's
 * markers stay hidden until the caret enters its range (the construct-reveal
 * trigger, `components/blocks/text/construct-reveal.ts`).
 *
 * Every door — the `data-presentation` root attribute, the block/leaf/widget
 * context getters, and `EditorContext.presentationMode` — reports the EFFECTIVE
 * mode, so a consumer or plugin never renders for a mode the editor is not
 * actually in. All four rungs are built, so the effective mode currently equals
 * the requested one; the editor's `effectiveMode` derived is the seam a future
 * effective-vs-requested divergence would land in.
 */

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline';

/** The two live-preview rungs share their marker-hiding CSS families and the
 *  focus-tracking `data-focused` attribute. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/**
 * The read-only gate the dispatch seams key off. Reads the effective mode through a
 * dedicated getter — the same `PresentationModeGetter` the block components read off
 * the editor-policies facet — threaded into each dispatch context beside the plugin
 * lookup, never smuggled through it (a mode read is not a plugin concern). Structural
 * parameter type so schema/selection layers need no editor-keys import; a `undefined`
 * getter (test doubles, unwired surfaces) means not reading.
 */
export function isReadingMode(getMode: (() => PresentationMode) | undefined): boolean {
	return getMode?.() === 'reading';
}
