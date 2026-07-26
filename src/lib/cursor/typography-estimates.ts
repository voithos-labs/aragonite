/**
 * Typography estimate constants shared by the two subsystems that guess block
 * geometry before a real measurement exists: the windowing height oracle
 * (`height-oracle.ts`, configured from `Editor.svelte`) and the visual-line
 * detector's fallback (`visual-lines.ts`).
 *
 * These are empirical pixel estimates of the editor font's rendered line box,
 * measured at {@link ESTIMATE_BASE_FONT_SIZE}. Character width has no CSS number
 * to derive it from, so the whole set is mirrored by hand at one scale. One home,
 * so a font-metric change updates them together instead of drifting across files.
 *
 * The editor's type scale is font-relative (`line-height` is unitless), so a host
 * that overrides `--editor-font-size` moves every one of the font-relative terms
 * below. Consumers scale them by the root's live computed font size rather than
 * reading them raw — `Editor.svelte` does this for the oracle, since an estimate
 * calibrated for one scale can miss the windowing activation watermark entirely.
 */

/** The computed root font size the estimates below were measured at. */
export const ESTIMATE_BASE_FONT_SIZE = 16;

export const HEIGHT_ESTIMATES = {
	proseLineHeight: 24, // px per wrapped prose line
	codeLineHeight: 20, // px per code source line
	avgCharWidth: 8, // px, for chars-per-line from a container width
	blockChrome: 16, // px of margin/padding per block
	imageBlockMinHeight: 200 // px floor for an image-bearing paragraph
} as const;

/**
 * Fallback line height when `getComputedStyle(el).lineHeight` is `normal`
 * (parses to NaN). A generic sane line box, independent of the per-kind
 * estimates above.
 */
export const FALLBACK_LINE_HEIGHT = 20;

/**
 * Fallback content width when no editor element is measurable yet (pre-mount
 * geometry guesses, jsdom). A representative prose column; wrong is fine, a
 * second home is not.
 */
export const FALLBACK_CONTENT_WIDTH = 800;
