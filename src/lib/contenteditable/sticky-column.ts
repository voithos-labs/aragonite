/**
 * Sticky column: the intended horizontal cursor position (editor-relative
 * pixel X) that persists across multiple vertical arrow key presses, surviving
 * intermediate clamping on shorter visual lines. Captured on the first
 * vertical arrow after a reset, used at every cross-block focus transition.
 */

export interface StickyColumnState {
	get(): number | null;

	/**
	 * Idempotent — no-op if already set. That's what preserves the original
	 * intent through within-block clamping. Also no-op for non-finite input.
	 */
	capture(x: number): void;

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

/**
 * Keys that neither capture nor reset sticky column. Vertical arrows capture
 * separately; every other key not in this list resets. PageUp/PageDown don't
 * move the caret in contenteditable; bare modifiers are noise.
 */
export const PRESERVE_KEYS_NON_ARROW: readonly string[] = [
	'PageUp',
	'PageDown',
	'Shift',
	'Control',
	'Alt',
	'Meta'
];
