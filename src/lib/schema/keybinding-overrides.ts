/**
 * Per-instance keybinding overrides: the public override-entry type, the
 * normalized lookup it compiles into, and the lookup primitives the command
 * resolver composes with the built-in tables. Schema leaf — no upward deps,
 * no context reads. The map is passed into the resolver as an argument.
 */
import type { AnyBlockKind } from '../core/nodes';
import { normalizeChordStrict, type KeyBinding } from './keybindings';
import type { AnyCommandId } from './command-id';

/** A consumer override of the default keymap for one mounted editor (the `keybindings` prop). */
export interface KeybindingOverride {
	/** Chord string in the public format (Mod/Alt/Shift + key). See keybindings.ts. */
	chord: string;
	/** A command to bind (built-in or minted plugin id), or `null` to disable the chord (remove its binding). */
	command: AnyCommandId | null;
	/** Target one block kind's keymap — built-in, or a plugin kind via its exported
	 *  kind constant (branded; a raw string literal won't typecheck). Omit for the
	 *  editor-global scope. */
	kind?: AnyBlockKind;
	/**
	 * Static argument baked into the binding. `unknown` for coherence with
	 * `KeyBinding.arg`: a minted command's non-number arg (e.g. a `setKind`
	 * carrying a string) survives normalization; the handler type-guards it.
	 */
	arg?: unknown;
}

/** A normalized override entry: a concrete binding, or `'disabled'` (the chord is unbound). */
export type OverrideValue = KeyBinding | 'disabled';

/** Compiled per-instance override lookup, split by scope. */
export interface KeybindingOverrideMap {
	global: Map<string, OverrideValue>;
	byKind: Map<AnyBlockKind, Map<string, OverrideValue>>;
}

const EMPTY: KeybindingOverrideMap = { global: new Map(), byKind: new Map() };

/** Compile the `keybindings` prop into the scoped lookup. Malformed chords are dev-warned and dropped. */
export function normalizeKeybindingOverrides(
	overrides: KeybindingOverride[] | undefined
): KeybindingOverrideMap {
	if (!overrides || overrides.length === 0) return EMPTY;
	const global = new Map<string, OverrideValue>();
	const byKind = new Map<AnyBlockKind, Map<string, OverrideValue>>();
	for (const o of overrides) {
		const chord = normalizeChordStrict(o.chord);
		if (chord === null) continue;
		const value: OverrideValue =
			o.command === null
				? 'disabled'
				: { chord, command: o.command, ...(o.arg !== undefined ? { arg: o.arg } : {}) };
		if (o.kind === undefined) {
			global.set(chord, value);
		} else {
			let kindMap = byKind.get(o.kind);
			if (!kindMap) {
				kindMap = new Map();
				byKind.set(o.kind, kindMap);
			}
			kindMap.set(chord, value);
		}
	}
	return { global, byKind };
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

/** Resolve one tier: a binding (use it), null (decided unbound — disabled), undefined (no decision). */
export function overrideDecision(value: OverrideValue | undefined): KeyBinding | null | undefined {
	if (value === undefined) return undefined;
	return value === 'disabled' ? null : value;
}
