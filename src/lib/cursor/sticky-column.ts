/**
 * Sticky column: the intended horizontal cursor position (editor-relative
 * pixel X) that persists across multiple vertical arrow key presses, surviving
 * intermediate clamping on shorter visual lines.
 *
 * Two-axis contract for participating surfaces (a surface that implements
 * focusAtColumn):
 *
 * 1. Capture (source-block responsibility). The block that holds focus when
 *    the user presses ArrowUp/ArrowDown MUST call stickyColumn.capture(x) with
 *    the cursor's editor-relative pixel X, before any cross-block focus
 *    transition. handleSharedKeydown performs this capture in its prelude;
 *    blocks that route their keydown through it participate automatically.
 *    Surfaces that bypass handleSharedKeydown (future plugins with custom
 *    arrow handling) MUST replicate the capture call themselves.
 *
 * 2. Consumption (caller-reads-and-passes). When a cross-block focus
 *    transition runs through moveFocus({ stickyColumnFrom }), the focus
 *    dispatchers route the landing through consumeStickyLanding
 *    (editor-actions/focus/focus-landing.ts), which reads stickyColumn.get(),
 *    null-checks, and either invokes focusAtColumn(x, from) with the finite x
 *    or falls back to focus(0) / focus(CURSOR_END). Target blocks'
 *    focusAtColumn is a pure receiver — x is always finite; null-handling
 *    lives in the landing helper.
 */

import type { EditorX } from './coordinate-spaces';
import {
	isInteractionTraceEnabled,
	traceStickyCapture,
	traceStickyReset
} from '../debug/interaction-trace';

export interface StickyColumnState {
	get(): EditorX | null;

	/**
	 * Idempotent — no-op if already set. That's what preserves the original
	 * intent through within-block clamping. Also no-op for non-finite input.
	 */
	capture(x: EditorX): void;

	reset(): void;
}

export function createStickyColumnState(): StickyColumnState {
	let stickyX: EditorX | null = null;

	return {
		get: () => stickyX,
		capture: (x: EditorX) => {
			if (stickyX !== null) return;
			if (!Number.isFinite(x)) return;
			stickyX = x;
			traceStickyCapture(x);
		},
		// Record only a real clear: reset fires on nearly every keystroke, so the
		// enabled gate short-circuits before the state read (advisor's honest-one-check).
		reset: () => {
			if (isInteractionTraceEnabled() && stickyX !== null) traceStickyReset();
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

/** What a keydown does to sticky column, decided purely from `e.key`. */
export type StickyKeyAction = 'capture' | 'reset' | 'preserve';

/**
 * The keydown→sticky decision the shared prelude enacts. Pure on the key so it
 * is testable without DOM; `handleSharedKeydown` reads it and supplies the
 * pixel X for the capture branch.
 */
export function classifyStickyKey(key: string): StickyKeyAction {
	if (key === 'ArrowUp' || key === 'ArrowDown') return 'capture';
	if (PRESERVE_KEYS_NON_ARROW.includes(key)) return 'preserve';
	return 'reset';
}
