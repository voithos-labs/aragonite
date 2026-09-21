/**
 * The presentation-mode contract. `source` is the editing default (styled source, always
 * visible); `reading` hides markers and makes the document read-only; `preview-block` shows the
 * markers in the caret's block and `preview-inline` narrows that to the construct the caret
 * touches (`components/blocks/text/construct-reveal.ts`); `live` hides markers and shows none of
 * them back, while staying editable. Every read reports the mode in effect.
 */

export type PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live';

/** Keyed by the union, so a mode added to it fails `npm run check` here rather than falling
 *  silently through {@link asPresentationMode}. */
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
 * the stylesheet and the caret traversal disagree about the same block.
 */
export function asPresentationMode(value: string | null | undefined): PresentationMode {
	return value != null && Object.hasOwn(MODES, value) ? (value as PresentationMode) : 'source';
}

/** Membership for the marker-hiding CSS families and the `data-list-marker` hook that
 *  feeds them: styled source is the one mode that paints Markdown syntax. */
export function hidesMarkers(mode: PresentationMode): boolean {
	return mode !== 'source';
}

/** The modes that show markers back when a block is focused, the only ones that need the
 *  `data-focused` attribute; live hides markers (see `hidesMarkers`) and never shows them
 *  back, so it is deliberately not one. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/**
 * Whether the mode paints a marker in the block the caret is in: styled source always, and the
 * preview modes by showing that block's markers. The question everything that writes at the caret
 * asks, since a rewrite may only drop bytes the user never saw (live-mode.md § 2).
 */
export function paintsFocusedMarkers(mode: PresentationMode): boolean {
	return !hidesMarkers(mode) || isPreviewMode(mode);
}

/**
 * The read-only check every dispatch path keys off. The parameter is a plain function type
 * so `schema/` and `selection/` need no `editor-keys` import; an `undefined` getter (a test
 * double, an editor not wired up) means not reading mode.
 */
export function isReadingMode(getMode: (() => PresentationMode) | undefined): boolean {
	return getMode?.() === 'reading';
}
