/**
 * Sticky column: the intended horizontal cursor position (editor-relative
 * pixel X) that persists across multiple vertical arrow key presses, surviving
 * intermediate clamping on shorter visual lines.
 *
 * Two-axis contract for participating surfaces (a surface that implements
 * focusAtColumn):
 *
 * 1. Capture (source-block responsibility). The block that holds focus when
 *    the user presses ArrowUp/ArrowDown MUST record the cursor's
 *    editor-relative pixel X before any cross-block focus transition. A keydown
 *    handler does this through `noteKey`, the door that also owns the reset and
 *    preserve cases; blocks routing their keydown through handleSharedKeydown
 *    or the cross-block dispatcher participate automatically. Surfaces with
 *    custom arrow handling (the table today, future plugins) MUST call
 *    `noteKey` themselves, or carry both capture and reset explicitly — the
 *    G2.10 source-scan guards hold them to it.
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
import { BARE_MODIFIER_KEYS } from '../schema/keybindings';

export interface StickyColumnState {
	get(): EditorX | null;

	/**
	 * Idempotent — no-op if already set. That's what preserves the original
	 * intent through within-block clamping. Also no-op for non-finite input.
	 */
	capture(x: EditorX): void;

	reset(): void;

	/**
	 * The only door a keydown handler may use: classifies the key and applies
	 * capture, preserve, or reset. `reset()` stays public for the lifecycle,
	 * commit, undo and paste callers, whose unconditional clear is correct and
	 * has no key to classify.
	 *
	 * `measureX` is consulted only on the capture branch, and only the caller
	 * can supply it — the pixel X comes from the live caret. A caller with no
	 * caret to measure (the cross-block dispatcher holds a range) omits it, and
	 * a capture key then PRESERVES the column rather than clearing it.
	 */
	noteKey(e: Pick<KeyboardEvent, 'key' | 'altKey'>, measureX?: () => EditorX | null): void;
}

export function createStickyColumnState(): StickyColumnState {
	let stickyX: EditorX | null = null;

	const state: StickyColumnState = {
		get: () => stickyX,
		capture: (x: EditorX) => {
			if (stickyX !== null) return;
			if (!Number.isFinite(x)) return;
			stickyX = x;
			traceStickyCapture(x);
		},
		// Record only a real clear: reset fires on nearly every keystroke, so the
		// enabled gate short-circuits before the state read.
		reset: () => {
			if (isInteractionTraceEnabled() && stickyX !== null) traceStickyReset();
			stickyX = null;
		},
		noteKey: (e, measureX) => {
			// Alt+Arrow is the block-reorder chord, not caret nav — it neither
			// captures nor resets.
			if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;

			const action = classifyStickyKey(e.key);
			if (action === 'reset') {
				state.reset();
				return;
			}
			if (action !== 'capture') return;
			const x = measureX?.();
			if (x !== null && x !== undefined) state.capture(x);
		}
	};

	return state;
}

/**
 * Keys that neither capture nor reset sticky column. Vertical arrows capture
 * separately; every other key not in this list resets. PageUp/PageDown don't
 * move the caret in contenteditable; bare modifiers are the chord parser's set,
 * read rather than re-listed — a local copy missing AltGraph/CapsLock is how a
 * modifier tap mid-arrow-run dropped the column.
 */
export const PRESERVE_KEYS_NON_ARROW: readonly string[] = [
	'PageUp',
	'PageDown',
	...BARE_MODIFIER_KEYS
];

/** What a keydown does to sticky column, decided purely from `e.key`. */
export type StickyKeyAction = 'capture' | 'reset' | 'preserve';

/**
 * The keydown→sticky decision {@link StickyColumnState.noteKey} enacts. Pure on
 * the key so the matrix is testable without a DOM or a state instance.
 */
export function classifyStickyKey(key: string): StickyKeyAction {
	if (key === 'ArrowUp' || key === 'ArrowDown') return 'capture';
	if (PRESERVE_KEYS_NON_ARROW.includes(key)) return 'preserve';
	return 'reset';
}
