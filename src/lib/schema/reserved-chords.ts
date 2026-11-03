/**
 * Which modifier chords a mounted editor takes anywhere: the keymaps from the registries, the text
 * keys from `textKeyRole`. A hand-written keydown branch takes only chords those already name; a
 * source scan holds every file that reads a modifier flag to that (G4.29).
 */
import { getAllRegisteredKinds } from './block-kind-descriptor';
import { GLOBAL_KEYMAP, kindKeymap, pluginGlobalChords, reservedUiChords } from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import type { PluginActivation } from './plugin-activation';
import { kindEnablementFor } from './registry-view';
import { textKeyChords } from './keybindings';

// ── Composition ──────────────────────────────────────────────────────────────

export interface ReservedChordOptions {
	/** The instance's live `searchBar` value: with the bar off the editor consumes neither
	 *  Find nor Replace. */
	searchBar: boolean;
	/** The instance's compiled `keybindings` prop, so an override's binds and disables show. */
	keybindings?: KeybindingOverrideMap;
	/** The plugins this instance activated: a chord another editor's plugin bound is not this
	 *  editor's. */
	activation: PluginActivation;
}

/** Every modifier chord `claimsChord` can answer true for somewhere, normalized. Composed on each
 *  call: kind keymaps, plugin chords and the override map all change under a live editor. */
export function collectReservedChords(options: ReservedChordOptions): ReadonlySet<string> {
	const textChords = textKeyChords();
	const claimed = new Set(
		[
			...registeredKeymapChords(options.activation),
			...GLOBAL_KEYMAP.map((binding) => binding.chord),
			...pluginGlobalChords(options.activation),
			...textChords,
			...(options.searchBar ? reservedUiChords() : []),
			...overrideBoundChords(options.keybindings)
		].filter(carriesModifier)
	);
	// A global disable unbinds the chord at every command level; a text key is the text's anyway.
	for (const chord of globallyDisabledChords(options.keybindings)) {
		if (!textChords.includes(chord)) claimed.delete(chord);
	}
	return claimed;
}

/** Modifier-carrying, so the fixed-order normal form puts something before the key. */
function carriesModifier(chord: string): boolean {
	return chord.includes('+');
}

/** Only the kinds this editor resolves: an unlisted plugin's kind renders nowhere here, so its
 *  keymap takes no chord. */
function registeredKeymapChords(activation: PluginActivation): string[] {
	const isEnabled = kindEnablementFor(activation);
	return getAllRegisteredKinds()
		.filter(isEnabled)
		.flatMap((kind) => kindKeymap(kind).map((binding) => binding.chord));
}

function overrideBoundChords(overrides: KeybindingOverrideMap | undefined): string[] {
	if (!overrides) return [];
	return [overrides.global, ...overrides.byKind.values()].flatMap((scope) =>
		[...scope].filter(([, value]) => value !== 'disabled').map(([chord]) => chord)
	);
}

function globallyDisabledChords(overrides: KeybindingOverrideMap | undefined): string[] {
	if (!overrides) return [];
	return [...overrides.global].filter(([, value]) => value === 'disabled').map(([chord]) => chord);
}
