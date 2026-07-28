/**
 * Keyboard chord parsing and the per-kind binding shape. `Mod` is the
 * cross-platform Ctrl-or-Cmd modifier. A chord is a normalized string:
 * modifiers in fixed order (Mod, Alt, Shift) then the key, single letters
 * uppercased. Shifted-symbol keys (e.g. Shift+1 -> '!') are not modeled —
 * no in-scope binding needs them.
 */
import type { AnyCommandId } from './command-id';
import { devWarn } from '../dev-warn';

export interface KeyBinding {
	chord: string;
	command: AnyCommandId;
	/**
	 * Static argument baked into the binding. Widened past the built-in
	 * `heading.cycle` level so a minted command (e.g. a `setKind` carrying a
	 * string) can travel the same channel. It reaches the handler as `unknown`:
	 * the handler must type-guard it before use and ignore an out-of-shape value.
	 */
	arg?: unknown;
}

const MOD_ORDER = ['Mod', 'Alt', 'Shift'] as const;

/**
 * Keys that are a modifier being held, never a keystroke in their own right —
 * `eventToChord` returns null for them, and every other keydown consumer that
 * must ignore "not a chord yet" reads this set rather than re-listing it (the
 * sticky column's own copy was short two entries, so CapsLock dropped it).
 */
export const BARE_MODIFIER_KEYS: readonly string[] = [
	'Control',
	'Shift',
	'Alt',
	'Meta',
	'AltGraph',
	'CapsLock'
];
const BARE_MODIFIERS = new Set<string>(BARE_MODIFIER_KEYS);

function normalizeKey(key: string): string {
	return key.length === 1 ? key.toUpperCase() : key;
}

export function eventToChord(e: KeyboardEvent): string | null {
	if (BARE_MODIFIERS.has(e.key)) return null;
	const mods: string[] = [];
	if (e.ctrlKey || e.metaKey) mods.push('Mod');
	if (e.altKey) mods.push('Alt');
	if (e.shiftKey) mods.push('Shift');
	return [...mods, normalizeKey(e.key)].join('+');
}

export function normalizeChord(chord: string): string {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	const present = new Set(parts);
	const mods = MOD_ORDER.filter((m) => present.has(m));
	return [...mods, normalizeKey(key)].join('+');
}

const VALID_MODIFIERS = new Set<string>(MOD_ORDER);

/**
 * Why a chord is malformed — an empty key, or a non-final token that isn't a
 * recognized modifier — or null when it's well-formed. Shared core of the strict
 * paths; keeping the reason lets `normalizeChordStrict` name it in the warn.
 */
function chordDefect(chord: string): string | null {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	if (key === '') return 'empty key';
	const bad = parts.find((mod) => !VALID_MODIFIERS.has(mod));
	return bad === undefined ? null : `unrecognized modifier "${bad}" (use Mod/Alt/Shift)`;
}

/**
 * True when every non-final token is Mod/Alt/Shift and the key is non-empty —
 * the well-formedness the strict ingestion paths gate on, so a mis-typed
 * `'Ctrl+B'` can't collapse to a bare `'B'` that fires on every keypress. Pure:
 * the caller decides whether to warn (consumer override), throw (registration
 * API), or report (the keymap-coherence invariant).
 */
export function isChordWellFormed(chord: string): boolean {
	return chordDefect(chord) === null;
}

/**
 * Validate then normalize a consumer-supplied chord. Returns null (dev-warned)
 * when malformed — guarding the trap where `'Ctrl+B'` silently drops the
 * unrecognized `Ctrl` and collapses to bare `'B'`.
 */
export function normalizeChordStrict(chord: string): string | null {
	const defect = chordDefect(chord);
	if (defect !== null) {
		devWarn('keybindings', `chord "${chord}": ${defect}; entry dropped`);
		return null;
	}
	return normalizeChord(chord);
}
