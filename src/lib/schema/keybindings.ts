/**
 * Keyboard chord parsing and the per-kind binding shape. `Mod` is the cross-platform
 * Ctrl-or-Cmd modifier; a chord is modifiers in fixed order (Mod, Alt, Shift) then the key,
 * single letters uppercased. Shifted-symbol keys (Shift+1 -> '!') are not modeled.
 */
import type { AnyCommandId } from './command-id';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { usesMacEditingConventions } from './platform-conventions';

export interface KeyBinding {
	chord: string;
	command: AnyCommandId;
	/**
	 * Static argument baked into the binding, widened so a plugin command's argument travels the
	 * same channel. It reaches the handler as `unknown`, which must type-guard before use.
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

/** The fields of a keydown a chord is read from; a `KeyboardEvent` is one. */
export type ChordKeys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function eventToChord(e: ChordKeys): string | null {
	if (BARE_MODIFIERS.has(e.key)) return null;
	const mods: string[] = [];
	if (e.ctrlKey || e.metaKey) mods.push('Mod');
	if (e.altKey) mods.push('Alt');
	if (e.shiftKey) mods.push('Shift');
	return [...mods, normalizeKey(e.key)].join('+');
}

/** Mod+A, CapsLock or not (CapsLock uppercases the key without a Shift). Select-all is a browser
 *  chord rather than a keymap command, so every block asks this one predicate. */
export function isSelectAllChord(e: ChordKeys): boolean {
	return eventToChord(e) === 'Mod+A';
}

/** Whether a key ends a run of select-all keypresses: any chord but Mod+A, not a held modifier. */
export function endsSelectAllRun(e: ChordKeys): boolean {
	return eventToChord(e) !== null && !isSelectAllChord(e);
}

// ── Caret-edge keys ──────────────────────────────────────────────────────────

/**
 * Where a caret-edge key sends the caret: its visual line's edge, the edge of the block's text (a
 * table cell's, in a cell), or with Shift the document's. `arrow` marks the Cmd+Arrow spelling,
 * which the browser moves natively on macOS and nowhere else.
 */
export type CaretEdgeKey =
	| {
			readonly to: 'line';
			readonly side: 'start' | 'end';
			readonly extend: boolean;
			readonly arrow: boolean;
	  }
	| { readonly to: 'block' | 'doc'; readonly side: 'start' | 'end'; readonly arrow: boolean };

/** A keydown's key and whichever modifier flags it carries; an absent flag is not held. */
export type EdgeKeys = Pick<KeyboardEvent, 'key'> &
	Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>>;

/**
 * The one reading of a caret-edge key, from Home and End with their usual modifiers or from
 * macOS's Cmd+Arrow (`docs/design/editor.md` § Browser engines). Every edge site asks here.
 */
export function caretEdgeKey(e: EdgeKeys): CaretEdgeKey | null {
	if (e.key === 'Home' || e.key === 'End') {
		const side = e.key === 'Home' ? 'start' : 'end';
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.shiftKey) return { to: 'doc', side, arrow: false };
		if (e.altKey) return null;
		return mod
			? { to: 'block', side, arrow: false }
			: { to: 'line', side, extend: e.shiftKey === true, arrow: false };
	}
	// The raw Meta flag, never `Mod`: Ctrl+Arrow is word motion on Windows and Linux.
	if (!e.metaKey || e.ctrlKey || e.altKey) return null;
	switch (e.key) {
		case 'ArrowLeft':
			return { to: 'line', side: 'start', extend: e.shiftKey === true, arrow: true };
		case 'ArrowRight':
			return { to: 'line', side: 'end', extend: e.shiftKey === true, arrow: true };
		case 'ArrowUp':
			return { to: e.shiftKey ? 'doc' : 'block', side: 'start', arrow: true };
		case 'ArrowDown':
			return { to: e.shiftKey ? 'doc' : 'block', side: 'end', arrow: true };
		default:
			return null;
	}
}

/** Which way a page key moves the caret, and whether Shift grows a selection with it. */
export interface PageKey {
	readonly direction: 'up' | 'down';
	readonly extend: boolean;
}

/** The one reading of PageUp and PageDown; null with Ctrl, Cmd or Alt held, which the browser
 *  keeps (Ctrl+PageDown switches tabs). */
export function pageKey(e: EdgeKeys): PageKey | null {
	if (e.key !== 'PageUp' && e.key !== 'PageDown') return null;
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	return { direction: e.key === 'PageUp' ? 'up' : 'down', extend: e.shiftKey === true };
}

/** A key that moves the caret along the text, and whether Shift grows a selection with it. */
export interface MotionKey {
	readonly unit: 'character' | 'word' | 'line-edge' | 'block-edge';
	readonly direction: 'backward' | 'forward';
	readonly extend: boolean;
	/** The Cmd+Arrow spelling of a line or block edge, which the browser moves for on macOS only. */
	readonly arrow: boolean;
}

/** The one reading of a horizontal caret key: an arrow, the word chord (Option on a Mac, Ctrl
 *  elsewhere), or a line or block edge; null for any other key, a document edge included. */
export function motionKey(e: EdgeKeys): MotionKey | null {
	const edge = caretEdgeKey(e);
	if (edge) {
		if (edge.to === 'doc') return null;
		return {
			unit: edge.to === 'line' ? 'line-edge' : 'block-edge',
			direction: edge.side === 'start' ? 'backward' : 'forward',
			extend: edge.to === 'line' && edge.extend,
			arrow: edge.arrow
		};
	}
	if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return null;
	const direction = e.key === 'ArrowLeft' ? 'backward' : 'forward';
	const extend = e.shiftKey === true;
	const word = usesMacEditingConventions() ? e.altKey && !e.ctrlKey : e.ctrlKey && !e.altKey;
	if (e.metaKey) return null;
	if (word) return { unit: 'word', direction, extend, arrow: false };
	if (e.ctrlKey || e.altKey) return null;
	return { unit: 'character', direction, extend, arrow: false };
}

/** Whether a normalized chord is a caret key `motionKey` reads on this platform, which the built-in
 *  and plugin keymaps yield to the caret; a consumer's own `keybindings` entry may still take one. */
export function isMotionChord(chord: string): boolean {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	const mod = parts.includes('Mod');
	const mac = usesMacEditingConventions();
	return (
		motionKey({
			key,
			ctrlKey: mod && !mac,
			metaKey: mod && mac,
			altKey: parts.includes('Alt'),
			shiftKey: parts.includes('Shift')
		}) !== null
	);
}

/** What a key does by a focused text field's own default, whatever a keymap binds: `writes` types,
 *  deletes, cuts, pastes or steps the history; `reads` moves the caret, grows a selection or copies. */
export type TextKeyRole = 'writes' | 'reads';

const TEXT_READ_CHORDS = new Set(['Mod+A', 'Mod+C', 'Mod+Insert']);
const TEXT_WRITE_CHORDS = new Set([
	'Mod+X',
	'Mod+V',
	'Mod+Shift+V',
	'Shift+Insert',
	'Mod+Z',
	'Mod+Y',
	'Mod+Shift+Z'
]);

/** The role a key plays in a text field, or null for a key no text field acts on by default. */
export function textKeyRole(e: ChordKeys): TextKeyRole | null {
	// Alt+ArrowUp and Down are no text field's: the editor's keymaps move blocks with them.
	const vertical = (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey;
	if (vertical || caretEdgeKey(e) || pageKey(e) || motionKey(e)) return 'reads';
	const chord = eventToChord(e);
	if (chord === null) return null;
	if (TEXT_READ_CHORDS.has(chord)) return 'reads';
	if (TEXT_WRITE_CHORDS.has(chord) || e.key === 'Backspace' || e.key === 'Delete') return 'writes';
	return typesCharacter(e) ? 'writes' : null;
}

/** A key that types its character: no command modifier, or Ctrl+Alt, which is AltGr off a Mac. */
function typesCharacter(e: ChordKeys): boolean {
	if (!isCharacterKey(e.key) || e.metaKey) return false;
	return !e.ctrlKey || (e.altKey && !usesMacEditingConventions());
}

export function normalizeChord(chord: string): string {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	const present = new Set(parts);
	const mods = MOD_ORDER.filter((m) => present.has(m));
	return [...mods, normalizeKey(key)].join('+');
}

const VALID_MODIFIERS = new Set<string>(MOD_ORDER);

/** Why a chord is malformed, or null when it's well-formed; a registration's error names it. */
function chordDefect(chord: string): string | null {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	if (key === '') return 'empty key';
	const bad = parts.find((mod) => !VALID_MODIFIERS.has(mod));
	return bad === undefined ? null : `unrecognized modifier "${bad}" (use Mod/Alt/Shift)`;
}

/**
 * Validate then normalize a chord a registration declares, throwing on a malformed one, so a
 * mis-typed `'Ctrl+B'` never collapses to a bare `'B'` that fires on every keypress.
 */
export function registeredChord(chord: string, entry: string): string {
	const defect = chordDefect(chord);
	if (defect !== null) throw new Error(`${entry}: chord "${chord}" is malformed: ${defect}`);
	return normalizeChord(chord);
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
