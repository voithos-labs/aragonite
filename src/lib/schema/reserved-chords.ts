/**
 * Which modifier chords a mounted editor consumes. The keymap tiers enumerate from the
 * registries; chords claimed by hand-written keydown branches do not, so they ride the
 * manifest below — G4.29's source scan fails until a new claiming site joins it. Bare keys
 * stay out of contract: a focused document owns them whatever the manifest says. A manifested
 * file keeps its literal key comparisons and modifier reads: the scan is structural on both
 * axes, so factoring either behind a helper fails the gate until the scan learns the helper.
 */
import { getAllRegisteredKinds, tryGetBlockKindDescriptor } from './block-kind-descriptor';
import { GLOBAL_KEYMAP, pluginGlobalChords, reservedUiChords } from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import { eventToChord, normalizeChord } from './keybindings';

// ── The hardcoded-chord manifest ─────────────────────────────────────────────

/** One library file that reads a KeyboardEvent modifier flag, and what it claims. */
export interface HardcodedChordSite {
	/** Path under `src/lib`, as G4.29's scan reports it. */
	file: string;
	/** Modifier chords the file consumes outside every keymap. */
	chords: readonly string[];
	/** Key literals the file compares — the scan's evidence that `chords` is still current. */
	keys: readonly string[];
	/** Why the chord list is what it is, where the branches alone don't say. */
	note?: string;
}

export const HARDCODED_CHORD_SITES: readonly HardcodedChordSite[] = [
	{
		file: 'components/Editor.svelte',
		chords: [],
		keys: [],
		note: 'Mod-click link activation and the Mod-held `data-mod-active` affordance — no keystroke is consumed.'
	},
	{
		file: 'components/GapCaret.svelte',
		chords: [],
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'Delete',
			'Enter',
			'Escape'
		],
		note: 'The gap caret proxy claims the exits plus the Enter that mints; Ctrl/Meta/Alt yields to the global table, and Shift takes the plain arrow arm.'
	},
	{
		file: 'components/SearchBar.svelte',
		chords: ['Shift+Enter'],
		keys: ['Enter', 'Escape'],
		note: 'Previous match from the find input. Reachable only with the bar open, and the prose keymap binds the same chord anyway.'
	},
	{
		file: 'components/blocks/editable-leaf.ts',
		chords: [],
		keys: ['Enter'],
		note: 'Shift-click gate on the rendered surface — a pointer read.'
	},
	{
		file: 'components/link-card/LinkCard.svelte',
		chords: ['Shift+Tab'],
		keys: ['Enter', 'Tab'],
		note: "Backwards step of the open card's focus trap. Escape lives on the host, which must also close a card the document still holds the caret for, and the Mod+K entry chord rides the kind keymaps, so both reach `reservedChords` without a manifest entry."
	},
	{
		file: 'components/blocks/table/TableActionMenu.svelte',
		chords: ['Shift+Tab'],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Escape', 'Home', 'Tab'],
		note: "Backwards step of the open menu's focus trap."
	},
	{
		file: 'components/blocks/table/TableBlock.svelte',
		chords: ['Shift+F10'],
		keys: ['ContextMenu', 'F10'],
		note: 'The keyboard route to the cell action menu.'
	},
	{
		file: 'components/blocks/table/TableCellBlock.svelte',
		chords: ['Shift+ArrowUp', 'Shift+ArrowDown'],
		keys: ['ArrowDown', 'ArrowUp', 'Enter'],
		note: 'Starts the intra-table rectangle before the prose extend can walk the next leaf.'
	},
	{
		file: 'components/blocks/table/cell-keydown-plan.ts',
		chords: ['Mod+A', 'Shift+Tab'],
		keys: [
			'A',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'Delete',
			'Enter',
			'Tab',
			'a'
		]
	},
	{
		file: 'components/blocks/text/TextEditableBlock.svelte',
		chords: [],
		keys: ['Home'],
		note: 'Bare Home only; the modifier read is the guard that keeps Shift+Home native.'
	},
	{
		file: 'components/blocks/text/click-snap-guard.ts',
		chords: [],
		keys: [],
		note: 'The `hasModifier` predicate itself.'
	},
	{
		file: 'components/blocks/text/construct-reveal.ts',
		chords: [],
		keys: ['ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'],
		note: 'Declines every modified key rather than claiming one.'
	},
	{
		file: 'components/blocks/text/edge-policy-dispatch.ts',
		chords: [],
		keys: ['ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'],
		note: 'The caret-edge policy runs on plain keys; the modifier read is its gate.'
	},
	{
		file: 'components/blocks/text/widget-interaction.ts',
		chords: ['Shift+ArrowLeft', 'Shift+ArrowRight'],
		keys: ['Arrow*', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Escape'],
		note: 'Extends a selection into a widget. A modified arrow is also swallowed while a widget is selected, but that is a caret-coherence guard in a transient state, not a binding.'
	},
	{
		file: 'components/image/ImageResizeHandles.svelte',
		chords: [],
		keys: [],
		note: 'Shift locks the aspect ratio during a pointer drag.'
	},
	{
		file: 'components/image/image-widget-editing.ts',
		chords: ['Shift+ArrowLeft', 'Shift+ArrowRight'],
		keys: ['ArrowLeft', 'ArrowRight'],
		note: 'Keyboard resize of the selected image.'
	},
	{
		file: 'components/image/widget-dom.ts',
		chords: [],
		keys: [],
		note: 'Shift-click declines, so the block keeps cross-block extension.'
	},
	{
		file: 'cursor/edge-affinity.ts',
		chords: [],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp'],
		note: 'Classifies an arrival for the caret-side memory; consumes nothing.'
	},
	{
		file: 'cursor/sticky-column.ts',
		chords: [],
		keys: ['ArrowDown', 'ArrowUp'],
		note: 'Classifies a keystroke for the column memory; consumes nothing.'
	},
	{
		file: 'editor-actions/container-block-component.ts',
		chords: ['Mod+C', 'Mod+X'],
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'Delete',
			'Enter',
			'c',
			'x'
		],
		note: 'Whole-block copy/cut: a keydown carries no ClipboardEvent, so the chord is read here.'
	},
	{
		file: 'editor-actions/plugin/container.ts',
		chords: ['Alt+ArrowUp', 'Alt+ArrowDown'],
		keys: ['ArrowDown', 'ArrowUp'],
		note: 'Reorder for plugin containers, whose command dispatch is inert.'
	},
	{
		file: 'plugins/mermaid/MermaidBlock.svelte',
		chords: ['Mod+Enter'],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', 'Escape', 'Tab'],
		note: 'Commits the diagram edit; the arrows are the edit box’s boundary exits, and a modified one is declined rather than claimed. Bundled-plugin chord, listed unconditionally — it coincides with the table keymap, so gating it on the install would change no answer.'
	},
	{
		file: 'schema/keybindings.ts',
		chords: [],
		keys: [],
		note: 'The normalizer every other site reads.'
	},
	{
		file: 'selection/cross-block/keydown.ts',
		chords: [
			'Mod+A',
			'Mod+Shift+Home',
			'Mod+Shift+End',
			'Shift+ArrowUp',
			'Shift+ArrowDown',
			'Shift+ArrowLeft',
			'Shift+ArrowRight'
		],
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'B',
			'Backspace',
			'Delete',
			'E',
			'End',
			'Enter',
			'Escape',
			'Home',
			'I',
			'Tab',
			'X',
			'a',
			'b',
			'e',
			'i',
			'x'
		],
		note: 'The format-toggle and Mod+0-6 tests here only route a chord to the merged command registry, which is where those bindings live. Mod+Shift+X takes an arm of its own: unshifted Mod+X is the whole-block cut.'
	},
	{
		file: 'selection/cross-block/pointer.ts',
		chords: [],
		keys: [],
		note: 'Shift-click anchoring.'
	},
	{
		file: 'selection/dead-space-caret.ts',
		chords: [],
		keys: [],
		note: 'A modified click is a platform command, so the dead-space caret declines it.'
	},
	{
		file: 'selection/shared-keydown.ts',
		chords: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'],
		keys: [
			'Alt',
			'AltGraph',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'CapsLock',
			'Control',
			'Meta',
			'Shift',
			'a'
		],
		note: 'Extends across a block boundary once the native extend runs out of room.'
	}
];

const HARDCODED_CHORDS: ReadonlySet<string> = new Set(
	HARDCODED_CHORD_SITES.flatMap((site) => site.chords).map(normalizeChord)
);

// ── Composition ──────────────────────────────────────────────────────────────

export interface ReservedChordOptions {
	/** The instance's live `searchBar` value: with the bar off the editor claims neither
	 *  Find nor Replace. */
	searchBar: boolean;
	/** The instance's compiled `keybindings` prop, so an override's binds and disables show. */
	keybindings?: KeybindingOverrideMap;
}

/**
 * Every modifier chord this editor consumes, normalized. Composed on each call: kind keymaps,
 * the plugin tiers and the override map all change under a live editor.
 */
export function collectReservedChords(options: ReservedChordOptions): ReadonlySet<string> {
	const claimed = new Set(
		[
			...registeredKeymapChords(),
			...GLOBAL_KEYMAP.map((binding) => binding.chord),
			...pluginGlobalChords(),
			...HARDCODED_CHORDS,
			...(options.searchBar ? reservedUiChords() : []),
			...overrideBoundChords(options.keybindings)
		]
			.map(normalizeChord)
			.filter(carriesModifier)
	);
	// A global disable unbinds the chord at every command tier. A hardcoded branch never
	// consults the override map, so it keeps its claim.
	for (const chord of globallyDisabledChords(options.keybindings)) {
		if (!HARDCODED_CHORDS.has(chord)) claimed.delete(chord);
	}
	return claimed;
}

/**
 * True when `chords` claims this keystroke, under the editor's own normalization — Ctrl and
 * Cmd both fold to `Mod`, so a consumer never re-derives the platform rule.
 */
export function chordIsClaimed(event: KeyboardEvent, chords: ReadonlySet<string>): boolean {
	const chord = eventToChord(event);
	return chord !== null && chords.has(chord);
}

/** Modifier-carrying, so the fixed-order normal form puts something before the key. */
function carriesModifier(chord: string): boolean {
	return chord.includes('+');
}

function registeredKeymapChords(): string[] {
	return getAllRegisteredKinds().flatMap(
		(kind) => tryGetBlockKindDescriptor(kind)?.keymap?.map((binding) => binding.chord) ?? []
	);
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
