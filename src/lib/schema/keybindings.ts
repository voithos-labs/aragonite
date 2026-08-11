/**
 * Keyboard chord parsing and the per-kind binding shape. `Mod` is the cross-platform
 * Ctrl-or-Cmd modifier; a chord is modifiers in fixed order (Mod, Alt, Shift) then the key,
 * single letters uppercased. Shifted-symbol keys (Shift+1 -> '!') are not modeled.
 */
import type { AnyCommandId } from './command-id';
import { devWarn } from '../dev-warn';

export interface KeyBinding {
	chord: string;
	command: AnyCommandId;
	/**
	 * Static argument baked into the binding, widened so a minted command travels the same
	 * channel. It reaches the handler as `unknown`, which must type-guard before use.
	 */
	arg?: unknown;
}

const MOD_ORDER = ['Mod', 'Alt', 'Shift'] as const;

/**
 * Keys that are a modifier being held, never a keystroke of their own. Every keydown consumer
 * that must ignore "not a chord yet" reads this set rather than re-listing it.
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

/** A `key` value that is one typed character: one code point, so an astral glyph's two
 *  UTF-16 units still count as a single keystroke. */
export function isCharacterKey(key: string): boolean {
	return [...key].length === 1;
}

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
 * Why a chord is malformed, or null when it is well-formed. Shared core of the strict paths;
 * keeping the reason lets `normalizeChordStrict` name it in the warn.
 */
function chordDefect(chord: string): string | null {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	if (key === '') return 'empty key';
	const bad = parts.find((mod) => !VALID_MODIFIERS.has(mod));
	return bad === undefined ? null : `unrecognized modifier "${bad}" (use Mod/Alt/Shift)`;
}

/**
 * The well-formedness the strict ingestion paths gate on, so a mis-typed `'Ctrl+B'` can't
 * collapse to a bare `'B'` that fires on every keypress. Pure: the caller decides whether to
 * warn, throw, or report.
 */
export function isChordWellFormed(chord: string): boolean {
	return chordDefect(chord) === null;
}

/**
 * Validate then normalize a consumer-supplied chord; null (dev-warned) when malformed, guarding
 * the trap where `'Ctrl+B'` drops the unrecognized `Ctrl` and collapses to bare `'B'`.
 */
export function normalizeChordStrict(chord: string): string | null {
	const defect = chordDefect(chord);
	if (defect !== null) {
		devWarn('keybindings', `chord "${chord}": ${defect}; entry dropped`);
		return null;
	}
	return normalizeChord(chord);
}
