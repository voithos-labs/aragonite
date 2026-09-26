/**
 * What a keydown does to the sticky column, the editor-relative x that survives repeated
 * vertical arrows and clamping on shorter lines. The column itself lives in the caret memory
 * (`cursor/caret-memory.ts`); the arriving block reads it through `consumeStickyLanding`.
 */

import { BARE_MODIFIER_KEYS } from '../schema/keybindings';

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

/** Pure on the key, so the matrix is testable without a DOM or a memory instance. */
export function classifyStickyKey(key: string): StickyKeyAction {
	if (key === 'ArrowUp' || key === 'ArrowDown') return 'capture';
	if (PRESERVE_KEYS_NON_ARROW.includes(key)) return 'preserve';
	return 'reset';
}
