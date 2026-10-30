/**
 * Which modifier chords a mounted editor consumes anywhere. Keymap chords come from the
 * registries; chords taken by hand-written keydown branches are listed in `HARDCODED_CHORD_CLAIMS`
 * with where each is taken, and a source scan fails until every file that reads a modifier flag
 * is in its test-side manifest of key evidence (G4.29).
 */
import { getAllRegisteredKinds } from './block-kind-descriptor';
import { GLOBAL_KEYMAP, kindKeymap, pluginGlobalChords, reservedUiChords } from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import type { PluginActivation } from './plugin-activation';
import { kindEnablementFor } from './registry-view';
import { usesMacEditingConventions } from './platform-conventions';

// ── The hand-written chords ──────────────────────────────────────────────────

/** A chord a hand-written keydown branch takes outside every keymap. Each file's key literals,
 *  the G4.29 scan's evidence for it, are in `test/invariants/lint/hardcoded-chord-sites.ts`. */
export interface HardcodedChordClaim {
	/** Path under `src/lib`, as the source scan reports it. */
	file: string;
	/** Where focus is when the branch takes its chords. */
	scope: ChordSiteScope;
	chords: readonly string[];
	/** Reading mode keeps the branch. */
	inReading?: true;
}

/** Where a hardcoded chord is taken: every text block, a block focused whole, a range across
 *  blocks, the find bar, an open link card or menu, or within a block of one of the listed kinds. */
export type ChordSiteScope =
	'leaf' | 'whole-block' | 'range' | 'find-bar' | 'menu' | readonly string[];

export const HARDCODED_CHORD_CLAIMS: readonly HardcodedChordClaim[] = [
	{ file: 'components/SearchBar.svelte', scope: 'find-bar', chords: ['Shift+Enter'] },
	{ file: 'components/link-card/LinkCard.svelte', scope: 'menu', chords: ['Shift+Tab'] },
	{ file: 'components/blocks/table/TableActionMenu.svelte', scope: 'menu', chords: ['Shift+Tab'] },
	{
		file: 'components/blocks/table/TableBlock.svelte',
		scope: ['tableCell'],
		chords: ['Shift+F10', 'ContextMenu']
	},
	{
		file: 'components/blocks/table/TableCellBlock.svelte',
		scope: ['tableCell'],
		chords: ['Shift+ArrowUp', 'Shift+ArrowDown']
	},
	{
		file: 'components/blocks/table/cell-keydown-plan.ts',
		scope: ['tableCell'],
		chords: [
			'Mod+ArrowUp',
			'Mod+ArrowDown',
			'Alt+ArrowUp',
			'Alt+ArrowDown',
			'Mod+Alt+ArrowUp',
			'Mod+Alt+ArrowDown'
		],
		inReading: true
	},
	{
		file: 'components/blocks/text/widget-interaction.ts',
		scope: 'leaf',
		chords: ['Shift+ArrowLeft', 'Shift+ArrowRight']
	},
	{
		file: 'components/image/image-widget-editing.ts',
		scope: 'leaf',
		chords: ['Shift+ArrowLeft', 'Shift+ArrowRight']
	},
	{
		file: 'editor-actions/container-block-component.ts',
		scope: 'whole-block',
		chords: ['Mod+C', 'Mod+X']
	},
	{ file: 'plugins/mermaid/MermaidBlock.svelte', scope: ['mermaid'], chords: ['Mod+Enter'] },
	{
		file: 'schema/keybindings.ts',
		scope: 'leaf',
		chords: [
			'Mod+A',
			'Shift+Home',
			'Mod+Home',
			'Mod+End',
			'Mod+Shift+Home',
			'Mod+Shift+End',
			'Shift+PageUp',
			'Shift+PageDown'
		]
	},
	{
		file: 'selection/cross-block/keydown.ts',
		scope: 'range',
		chords: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight']
	},
	{
		file: 'selection/shared-keydown.ts',
		scope: 'leaf',
		chords: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight']
	}
];

/** The edge sites' Cmd+Arrow chords (macOS's Home and End), listed only where Cmd is the command
 *  key: the chord form folds in Ctrl+Arrow, which is word motion elsewhere. */
const CMD_EDGE_CHORDS: ReadonlySet<string> = new Set([
	'Mod+ArrowLeft',
	'Mod+ArrowRight',
	'Mod+ArrowUp',
	'Mod+ArrowDown',
	'Mod+Shift+ArrowLeft',
	'Mod+Shift+ArrowUp',
	'Mod+Shift+ArrowDown'
]);

const HARDCODED_CHORDS: ReadonlySet<string> = new Set(
	HARDCODED_CHORD_CLAIMS.flatMap((claim) => claim.chords)
);

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

/**
 * Every modifier chord this editor consumes, normalized. Composed on each call: kind keymaps,
 * plugin chords and the override map all change under a live editor.
 */
export function collectReservedChords(options: ReservedChordOptions): ReadonlySet<string> {
	const claimed = new Set(
		[
			...registeredKeymapChords(options.activation),
			...GLOBAL_KEYMAP.map((binding) => binding.chord),
			...pluginGlobalChords(options.activation),
			...HARDCODED_CHORDS,
			...(options.searchBar ? reservedUiChords() : []),
			...overrideBoundChords(options.keybindings)
		].filter(carriesModifier)
	);
	// A global disable unbinds the chord at every command level. A hardcoded branch never
	// consults the override map, so it keeps the chord.
	for (const chord of globallyDisabledChords(options.keybindings)) {
		if (!HARDCODED_CHORDS.has(chord)) claimed.delete(chord);
	}
	// Where Cmd is the command key; elsewhere the same chord form is Ctrl+Arrow, word motion.
	if (usesMacEditingConventions()) for (const chord of CMD_EDGE_CHORDS) claimed.add(chord);
	return claimed;
}

/** Whether a hand-written branch takes `chord` where `inScope` says focus is. */
export function hardcodedChordTaken(
	chord: string,
	inScope: (scope: ChordSiteScope) => boolean,
	reading: boolean
): boolean {
	return HARDCODED_CHORD_CLAIMS.some(
		(claim) =>
			claim.chords.includes(chord) && (!reading || claim.inReading === true) && inScope(claim.scope)
	);
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
