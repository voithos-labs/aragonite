/**
 * Sticky column: the intended horizontal cursor position (editor-relative
 * pixel X) that persists across multiple vertical arrow key presses,
 * surviving intermediate clamping on shorter visual lines.
 *
 * Captured on the first vertical arrow press after a reset. Used at every
 * cross-block focus transition until reset. The consumer decides when to
 * call `reset()` — see `PRESERVE_KEYS_NON_ARROW` below and the call sites
 * in `TextEditableBlock`, `CodeBlock`, and `Editor.svelte`'s structural
 * actions for the full reset-trigger policy.
 *
 * Both `TextEditableBlock` and `CodeBlock` are participating blocks — they
 * capture sticky X on vertical arrow presses and implement `focusAtColumn`.
 * The only non-participating leaf block is `ThematicBreakBlock`, which is
 * transparent (passes sticky X through without capturing or resetting).
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

/**
 * Keys that should NEITHER capture NOR reset sticky column on keydown.
 * Vertical arrows capture via a dedicated branch in the block's onKeyDown;
 * the keys in this list are the additional "do nothing to sticky" set:
 * PageUp/PageDown don't actually move the caret in contenteditable (and
 * shouldn't reset), and pure modifier keys on their own are noise.
 *
 * Every key NOT in this list AND not a vertical arrow resets sticky X —
 * including ArrowLeft, ArrowRight, Home, End, Escape, and every typable
 * character. That "reset by default, preserve explicitly" policy is how
 * horizontal arrows, Home/End, and Escape clear sticky without each one
 * needing its own dedicated handler.
 *
 * Exported so every editing block shares one source of truth — preventing
 * drift if the list is updated in one file but not another.
 */
export const PRESERVE_KEYS_NON_ARROW: readonly string[] = [
	'PageUp',
	'PageDown',
	'Shift',
	'Control',
	'Alt',
	'Meta'
];
