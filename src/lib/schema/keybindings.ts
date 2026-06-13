/**
 * Keyboard chord parsing and the per-kind binding shape. `Mod` is the
 * cross-platform Ctrl-or-Cmd modifier. A chord is a normalized string:
 * modifiers in fixed order (Mod, Alt, Shift) then the key, single letters
 * uppercased. Shifted-symbol keys (e.g. Shift+1 -> '!') are not modeled —
 * no in-scope binding needs them.
 */
import type { CommandId } from './commands';

export interface KeyBinding {
	chord: string;
	command: CommandId;
	/** Static argument baked into the binding (e.g. the heading level for `heading.cycle`). */
	arg?: number;
}

const MOD_ORDER = ['Mod', 'Alt', 'Shift'] as const;
const BARE_MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

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
