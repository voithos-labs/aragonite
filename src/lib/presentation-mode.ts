/**
 * The presentation-mode contract. `source` is the editing default (always-visible
 * styled source, byte-identical to pre-mode behavior); `reading` hides markers,
 * renders widgets, and makes the surface inert; `preview-block` is a live editing
 * mode that hides markers on every block except the one holding the caret (the
 * focused block renders exactly as `source` does). `preview-inline` — reveal per
 * caret-adjacent inline island — is the last rung; until its batch it collapses to
 * `preview-block`, the closest available behavior.
 *
 * Every door — the `data-presentation` root attribute, the block/leaf/widget
 * context getters, and `EditorContext.presentationMode` — reports the EFFECTIVE
 * mode, so a consumer or plugin never renders for a mode the editor is not
 * actually in. The `presentationMode` prop holds the requested value; when a
 * preview rung becomes real, the collapse narrows and no API changes.
 */

import { devWarn } from './dev-warn';

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline';

/** Modes not yet built; each collapses to the closest available one below. */
const STUB_MODES: ReadonlySet<PresentationMode> = new Set(['preview-inline']);

export function resolveEffectivePresentationMode(mode: PresentationMode): PresentationMode {
	return mode === 'preview-inline' ? 'preview-block' : mode;
}

export function warnStubPresentationMode(mode: PresentationMode): void {
	if (STUB_MODES.has(mode)) {
		devWarn(
			'presentation',
			`presentationMode '${mode}' is not yet implemented; renders as 'preview-block'`
		);
	}
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
