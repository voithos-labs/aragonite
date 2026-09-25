/**
 * Sticky column: the editor-relative pixel X that survives repeated vertical arrows and
 * intermediate clamping, for blocks that implement `focusAtColumn`. The focused block records X
 * through `noteKey` before any move to another block (G2.10); the arriving block reads it through
 * `consumeStickyLanding` (`editor-actions/focus/focus-landing.ts`), which null-checks and falls
 * back, so `focusAtColumn` always receives a finite x.
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

	/** Idempotent: doing nothing when already set is what keeps the original column through
	 *  clamping inside a block. Non-finite input is ignored. */
	capture(x: EditorX): void;

	reset(): void;

	/** The only entry point a keydown handler may use. `measureX` reads the live caret's X on a
	 *  capture key; a caller holding a range omits it, and the column is then kept. */
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
 * Bare modifiers come from the key-combination parser rather than a local list, which could
 * miss AltGraph or CapsLock and drop the column on a modifier tap mid-arrow-run.
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
