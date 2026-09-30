/**
 * The presentation-mode contract. `source` is the editing default (styled source); `reading`
 * hides markers and is read-only; the preview modes show markers back in the caret's block or
 * construct (`components/blocks/text/construct-reveal.ts`); `live` hides markers and shows none
 * back while staying editable. Every read reports the mode in effect.
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

/** Narrows a mode read off the DOM or handed in untyped: an unrecognized value reads as the
 *  editing default, as the marker-hiding CSS does, or the two would disagree about a block. */
export function asPresentationMode(value: string | null | undefined): PresentationMode {
	return value != null && Object.hasOwn(MODES, value) ? (value as PresentationMode) : 'source';
}

/** Membership for the marker-hiding CSS families and the `data-list-marker` hook that
 *  feeds them: styled source is the one mode that paints Markdown syntax. */
export function hidesMarkers(mode: PresentationMode): boolean {
	return mode !== 'source';
}

/** The modes that show markers back in a focused block, the only ones needing `data-focused`;
 *  live hides markers and never shows them back. */
export function isPreviewMode(mode: PresentationMode): boolean {
	return mode === 'preview-block' || mode === 'preview-inline';
}

/** Whether the mode paints markers in the caret's block: the check everything writing at the caret
 *  asks, since a rewrite may drop only bytes the user never saw (`docs/design/live-mode.md` § 2). */
export function paintsFocusedMarkers(mode: PresentationMode): boolean {
	return !hidesMarkers(mode) || isPreviewMode(mode);
}

/** The converse, the one check a rewrite asks before dropping delimiter bytes at the caret. */
export function hidesDelimitersAtCaret(mode: PresentationMode): boolean {
	return !paintsFocusedMarkers(mode);
}

/** The read-only check every dispatch path keys off. A plain getter type keeps `schema/` and
 *  `selection/` off `editor-keys`; the getter is required, since only the editor picks the default. */
export function isReadingMode(getMode: () => PresentationMode): boolean {
	return getMode() === 'reading';
}
