/**
 * Empirical pixel estimates of the editor font's line box, measured at
 * {@link ESTIMATE_BASE_FONT_SIZE}, for the windowing height model and the reads before mount.
 * Character width has no CSS number to derive from, so the set is mirrored by hand at one scale.
 * The editor's type scale is font-relative, so callers scale these by the root's live computed
 * font size; an estimate calibrated for one scale can miss the windowing threshold entirely.
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

/** Fallback content width when no editor element is measurable yet (pre-mount, jsdom). */
export const FALLBACK_CONTENT_WIDTH = 800;
