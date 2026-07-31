/**
 * Sticky column: the editor-relative pixel X that survives repeated vertical arrows and
 * intermediate clamping on shorter lines. Two-axis contract for `focusAtColumn` surfaces.
 * CAPTURE: the focused block records X before any cross-block transition, via `noteKey`
 * (custom arrow handling must call it — the G2.10 source-scan guards hold it to that).
 * CONSUME: focus dispatchers route landings through `consumeStickyLanding`
 * (`editor-actions/focus/focus-landing.ts`), which null-checks and falls back, so
 * `focusAtColumn` is a pure receiver whose x is always finite.
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

	/** Idempotent — the no-op-when-set is what preserves the original intent through
	 *  within-block clamping. Non-finite input is ignored. */
	capture(x: EditorX): void;

	reset(): void;

	/**
	 * The only door a keydown handler may use; `reset()` stays public for the lifecycle,
	 * commit, undo and paste callers, whose unconditional clear has no key to classify.
	 * `measureX` is consulted only on the capture branch and only the caller can supply it
	 * (the X comes from the live caret) — a caller holding a range rather than a caret
	 * omits it, and a capture key then PRESERVES the column rather than clearing it.
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
		// Reset fires on nearly every keystroke, so the enabled gate short-circuits first.
		reset: () => {
			if (isInteractionTraceEnabled() && stickyX !== null) traceStickyReset();
			stickyX = null;
		},
		noteKey: (e, measureX) => {
			// Alt+Arrow is the block-reorder chord, not caret nav.
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
 * Keys that neither capture nor reset; every key not here and not a vertical arrow resets.
 * Bare modifiers are read from the chord parser rather than re-listed — a local copy
 * missing AltGraph/CapsLock is how a modifier tap mid-arrow-run dropped the column.
 */
export const PRESERVE_KEYS_NON_ARROW: readonly string[] = [
	'PageUp',
	'PageDown',
	...BARE_MODIFIER_KEYS
];

/** What a keydown does to sticky column, decided purely from `e.key`. */
export type StickyKeyAction = 'capture' | 'reset' | 'preserve';

/** The decision {@link StickyColumnState.noteKey} enacts. Pure on the key, so the matrix is
 *  testable without a DOM or a state instance. */
export function classifyStickyKey(key: string): StickyKeyAction {
	if (key === 'ArrowUp' || key === 'ArrowDown') return 'capture';
	if (PRESERVE_KEYS_NON_ARROW.includes(key)) return 'preserve';
	return 'reset';
}
