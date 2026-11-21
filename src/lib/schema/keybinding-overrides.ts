/**
 * Per-instance keybinding overrides: the public override-entry type, the normalized lookup it
 * compiles into, and the primitives the command resolver composes with the built-in tables. The
 * map reaches the resolver as an argument, never through a context read.
 */
import type { AnyBlockKind } from '../core/nodes';
import { normalizeChordStrict, type KeyBinding } from './keybindings';
import type { AnyCommandId } from './command-id';
import type { Command } from './plugin-command';
import type { BlockType } from './plugin-unit';

/** A consumer override of the default keymap for one mounted editor (the `keybindings` prop). */
export interface KeybindingOverride {
	/** Chord string in the public format (Mod/Alt/Shift + key). See keybindings.ts. */
	chord: string;
	/** A command to bind (built-in or plugin id, or a plugin's command value), or `null` to disable
	 *  the chord, which then reaches the page; a disabled undo or redo is still swallowed. */
	command: AnyCommandId | Command<unknown> | null;
	/** One block kind's keymap: a built-in kind, a plugin kind's exported constant, or a block type.
	 *  Omit for the editor-global scope. */
	kind?: AnyBlockKind | BlockType<unknown>;
	/**
	 * Static argument baked into the binding. `unknown` to match `KeyBinding.arg`: a plugin
	 * command's non-number arg survives normalization, and the handler type-guards it.
	 */
	arg?: unknown;
}

/** A normalized override entry: a concrete binding, or `'disabled'` (the chord is unbound). */
export type OverrideValue = KeyBinding | 'disabled';

/** Compiled per-instance override lookup, split by scope. */
export interface KeybindingOverrideMap {
	global: Map<string, OverrideValue>;
	byKind: Map<AnyBlockKind, Map<string, OverrideValue>>;
	/** Every chord an entry names, in either scope. */
	chords: ReadonlySet<string>;
}

const EMPTY: KeybindingOverrideMap = { global: new Map(), byKind: new Map(), chords: new Set() };

/** Compile the `keybindings` prop into the scoped lookup. Malformed chords are dev-warned and dropped. */
export function normalizeKeybindingOverrides(
	overrides: KeybindingOverride[] | undefined
): KeybindingOverrideMap {
	if (!overrides || overrides.length === 0) return EMPTY;
	const global = new Map<string, OverrideValue>();
	const byKind = new Map<AnyBlockKind, Map<string, OverrideValue>>();
	const chords = new Set<string>();
	for (const o of overrides) {
		const chord = normalizeChordStrict(o.chord);
		if (chord === null) continue;
		chords.add(chord);
		// A value reads its name now, qualified once the editor runs its plugin.
		const command = typeof o.command === 'object' && o.command ? o.command.id : o.command;
		const kind = typeof o.kind === 'object' ? o.kind.name : o.kind;
		const value: OverrideValue =
			command === null
				? 'disabled'
				: {
						chord,
						command: command as AnyCommandId,
						...(o.arg !== undefined ? { arg: o.arg } : {})
					};
		if (kind === undefined) {
			global.set(chord, value);
		} else {
			let kindMap = byKind.get(kind as AnyBlockKind);
			if (!kindMap) {
				kindMap = new Map();
				byKind.set(kind as AnyBlockKind, kindMap);
			}
			kindMap.set(chord, value);
		}
	}
	return { global, byKind, chords };
}

/** Look up a single override for a (scope, chord). undefined when no entry exists. */
export function lookupOverride(
	overrides: KeybindingOverrideMap | undefined,
	scope: 'global' | AnyBlockKind,
	chord: string
): OverrideValue | undefined {
	if (!overrides) return undefined;
	if (scope === 'global') return overrides.global.get(chord);
	return overrides.byKind.get(scope)?.get(chord);
}

/** Resolve one override scope: a binding (use it), null (disabled), undefined (no entry). */
export function overrideDecision(value: OverrideValue | undefined): KeyBinding | null | undefined {
	if (value === undefined) return undefined;
	return value === 'disabled' ? null : value;
}
