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
 * actually in. All four rungs are built, so the effective mode now equals the
 * requested one; the seam stays because every door routes through it.
 */

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline';

export function resolveEffectivePresentationMode(mode: PresentationMode): PresentationMode {
	return mode;
}

/** The two live-preview rungs share their marker-hiding CSS families and the
 *  focus-tracking `data-focused` attribute. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/**
 * The read-only gate the dispatch seams key off. Reached through the per-instance
 * plugin-context lookup that already threads every dispatch tier (leaf chord
 * dispatch, container bubble, cross-block), so no caller carries a mode flag —
 * the getter is injected once, at the Editor's context construction. Structural
 * parameter type so schema/selection layers need no editor-keys import.
 */
export function isReadingMode(
	lookup: ((pluginName: string) => { readonly presentationMode: PresentationMode }) | undefined
): boolean {
	// The trailing ?. tolerates partial lookups (test doubles); the real
	// per-instance lookup always resolves a context.
	return lookup?.('')?.presentationMode === 'reading';
}
