/**
 * Sticky column: the intended horizontal cursor position (editor-relative
 * pixel X) that persists across multiple vertical arrow key presses,
 * surviving intermediate clamping on shorter visual lines.
 *
 * Captured on the first vertical arrow press after a reset. Used at every
 * cross-block focus transition until reset. Reset on any non-vertical-arrow
 * user action (see v0.3.3 Spec B, Rule S3 for the full trigger list).
 *
 * This module is intentionally pure: no Svelte, no DOM, no framework
 * coupling. Each `Editor.svelte` instance creates its own state via
 * `createStickyColumnState()` and provides it via the STICKY_COLUMN_KEY
 * Svelte context.
 */

export interface StickyColumnState {
	/** Current sticky X in editor-relative pixels, or null if not tracked. */
	get(): number | null;

	/**
	 * Capture the sticky X. No-op if already set (idempotent) — this is
	 * what preserves the "original intent" through within-block clamping.
	 * Also no-op if the input is not a finite number (NaN, Infinity).
	 */
	capture(x: number): void;

	/** Reset the sticky X to null. Called at all reset trigger sites. */
	reset(): void;
}

export function createStickyColumnState(): StickyColumnState {
	let stickyX: number | null = null;

	return {
		get: () => stickyX,
		capture: (x: number) => {
			if (stickyX !== null) return;
			if (!Number.isFinite(x)) return;
			stickyX = x;
		},
		reset: () => {
			stickyX = null;
		}
	};
}
