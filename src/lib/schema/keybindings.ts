/**
 * Keyboard chord parsing and the per-kind binding shape. `Mod` is the
 * cross-platform Ctrl-or-Cmd modifier. A chord is a normalized string:
 * modifiers in fixed order (Mod, Alt, Shift) then the key, single letters
 * uppercased. Shifted-symbol keys (e.g. Shift+1 -> '!') are not modeled —
 * no in-scope binding needs them.
 */
import type { CommandId } from './commands';
import { devWarn } from '../dev-warn';

export interface KeyBinding {
	chord: string;
	command: CommandId;
	/**
	 * Static argument baked into the binding. Widened past the built-in
	 * `heading.cycle` level so a minted command (e.g. a `setKind` carrying a
	 * string) can travel the same channel. It reaches the handler as `unknown`:
	 * the handler must type-guard it before use and ignore an out-of-shape value.
	 */
	arg?: unknown;
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

const VALID_MODIFIERS = new Set(['Mod', 'Alt', 'Shift']);

/**
 * Validate then normalize a consumer-supplied chord. Returns null (dev-warned)
 * when a non-final token is not a recognized modifier or the key is empty —
 * guarding the trap where `'Ctrl+B'` silently drops the unrecognized `Ctrl` and
 * collapses to bare `'B'`, a binding that would fire on every keypress.
 */
export function normalizeChordStrict(chord: string): string | null {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	if (key === '') {
		devWarn('keybindings', `chord "${chord}": empty key; entry dropped`);
		return null;
	}
	for (const mod of parts) {
		if (!VALID_MODIFIERS.has(mod)) {
			devWarn(
				'keybindings',
				`chord "${chord}": unrecognized modifier "${mod}" (use Mod/Alt/Shift); entry dropped`
			);
			return null;
		}
	}
	return normalizeChord(chord);
}
