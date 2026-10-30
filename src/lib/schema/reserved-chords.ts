/**
 * Which modifier chords a mounted editor consumes anywhere. Keymap chords come from the
 * registries; chords taken by hand-written keydown branches are listed in `HARDCODED_CHORD_SITES`
 * with where each is taken, and a source scan fails until a new such file is added there (G4.29).
 * A listed file keeps its literal key comparisons and modifier reads, the scan's evidence.
 */
import { getAllRegisteredKinds } from './block-kind-descriptor';
import { GLOBAL_KEYMAP, kindKeymap, pluginGlobalChords, reservedUiChords } from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import type { PluginActivation } from './plugin-activation';
import { kindEnablementFor } from './registry-view';
import { usesMacEditingConventions } from './platform-conventions';

// ── The hardcoded-chord list ─────────────────────────────────────────────────

/** One library file that reads a KeyboardEvent modifier flag, and the chords it consumes. */
export interface HardcodedChordSite {
	/** Path under `src/lib`, as the source scan reports it. */
	file: string;
	/** Chords the file consumes outside every keymap, where focus is when it does, and whether
	 *  reading mode keeps the branch. */
	claims?: {
		readonly scope: ChordSiteScope;
		readonly chords: readonly string[];
		readonly inReading?: true;
	};
	/** Key literals the file compares — the scan's evidence that `chords` is still current. */
	keys: readonly string[];
	/** Why the chord list is what it is, where the branches alone don't say. */
	note?: string;
}

/** Where a hardcoded chord is taken: every text block, a block focused whole, a range across
 *  blocks, the find bar, an open link card or menu, or within a block of one of the listed kinds. */
export type ChordSiteScope =
	'leaf' | 'whole-block' | 'range' | 'find-bar' | 'menu' | readonly string[];

export const HARDCODED_CHORD_SITES: readonly HardcodedChordSite[] = [
	{
		file: 'activation-click.ts',
		keys: [],
		note: 'Ctrl/Cmd on a click that may follow a link or a widget, read for every such route: no keystroke is consumed.'
	},
	{
		file: 'components/editor-root/gestures.ts',
		keys: [],
		note: 'A modified press declines the margin drag, and a live-mode Mod-click skips the link card: no keystroke is consumed.'
	},
	{
		file: 'components/editor-root/key-claims.ts',
		keys: ['Arrow*', 'Backspace', 'Delete', 'Enter', 'Escape'],
		note: 'Answers `claimsChord` by asking what each handler on the key’s way asks; it consumes nothing itself.'
	},
	{
		file: 'components/editor-root/keydown.ts',
		keys: ['Backspace', 'Escape', 'H'],
		note: "Escape closes the find bar, and Mod+H picks the replace row as the bar opens (reserved UI chords, enumerated). Backspace outside a text field only loses the browser's own default (a step back in history, in some engines) and still reaches every handler. The modifier read is a refusal: an unchorded character over a live range is written as text, a chorded one goes to the handlers below it."
	},
	{
		file: 'debug/input-recorder.ts',
		keys: ['Process'],
		note: 'An input recording copies the modifier flags of every key it records, and reads an IME keydown (`Process`) to group a composition: no keystroke is consumed.'
	},
	{
		file: 'selection/selection-drop.ts',
		keys: [],
		note: 'Ctrl/Alt at the drop is the platform copy modifier, read off a DragEvent: no keystroke is consumed.'
	},
	{
		file: 'selection/multi-click.ts',
		keys: [],
		note: 'A modified multi-click is left to the browser (Shift extends, Mod activates): no keystroke is consumed.'
	},
	{
		file: 'selection/widget-press.ts',
		keys: [],
		note: "Control with the primary button is a Mac's right-click, read off a press: no keystroke is consumed."
	},
	{
		file: 'components/GapCaret.svelte',
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
		note: 'The gap caret proxy claims the exits plus the Enter that creates a block; Ctrl/Meta/Alt yields to the global table, and Shift takes the plain arrow branch.'
	},
	{
		file: 'components/SearchBar.svelte',
		claims: { scope: 'find-bar', chords: ['Shift+Enter'] },
		keys: ['Enter', 'Escape'],
		note: 'Previous match from the find input. Reachable only with the bar open, and the prose keymap binds the same chord anyway.'
	},
	{
		file: 'components/blocks/editable/editable-leaf.ts',
		keys: ['Backspace', 'Enter'],
		note: "Shift-click gate on the rendered surface, a pointer read; plain Backspace (no modifier) at the top of an empty painted source deletes the block, as the code block does. The reveal's own undo resolves its chord through the keymap, so it claims none here."
	},
	{
		file: 'components/link-card/LinkCard.svelte',
		claims: { scope: 'menu', chords: ['Shift+Tab'] },
		keys: ['Enter', 'Tab'],
		note: "Backwards step of the open card's focus trap. The chord that opens the card is swallowed there too, resolved through the keymap like everywhere else. Escape is the menu presence's, which also closes a card the document still holds the caret for."
	},
	{
		file: 'components/menu/BlockMenu.svelte',
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'],
		note: 'The open block menu steps and picks; the modifier read is the guard that leaves every chord to the editor. Escape is the menu presence’s.'
	},
	{
		file: 'components/blocks/table/TableActionMenu.svelte',
		claims: { scope: 'menu', chords: ['Shift+Tab'] },
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'Tab'],
		note: "Backwards step of the open menu's focus trap."
	},
	{
		file: 'components/blocks/table/TableBlock.svelte',
		claims: { scope: ['tableCell'], chords: ['Shift+F10', 'ContextMenu'] },
		keys: ['ContextMenu', 'F10'],
		note: 'The keyboard routes to the cell action menu.'
	},
	{
		file: 'components/blocks/table/TableCellBlock.svelte',
		claims: { scope: ['tableCell'], chords: ['Shift+ArrowUp', 'Shift+ArrowDown'] },
		keys: ['ArrowDown', 'ArrowUp', 'Enter'],
		note: 'Starts the intra-table rectangle before the prose extend can walk the next leaf.'
	},
	{
		file: 'components/blocks/table/cell-keydown-plan.ts',
		claims: {
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
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Backspace', 'Delete'],
		note: 'Arrows and Backspace or Delete at a cell edge move between cells. Up and Down move with any modifier but Shift, so an unbound Alt+ArrowUp still moves a row up; Tab and Enter are the keymap’s.'
	},
	{
		file: 'components/blocks/text/TextEditableBlock.svelte',
		keys: [],
		note: 'Its modifier read is on a pointer event (Shift extends a selection instead of dragging a widget), so it consumes no keystroke.'
	},
	{
		file: 'components/blocks/text/click-snap-guard.ts',
		keys: [],
		note: 'The `hasModifier` predicate itself.'
	},
	{
		file: 'components/blocks/text/construct-reveal.ts',
		keys: ['ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'],
		note: 'Declines every modified key rather than claiming one.'
	},
	{
		file: 'components/blocks/text/edge-policy-dispatch.ts',
		keys: [' ', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'],
		note: 'The caret-edge policy runs on plain keys; the modifier read is its gate. The bare space is container marker completion, consumed rather than claimed as a chord.'
	},
	{
		file: 'components/blocks/text/pending-break-keys.ts',
		keys: ['ArrowLeft', 'Backspace', 'Delete'],
		note: 'A plain Backspace or ArrowLeft, and any Delete, ends the pending break and stops there; Backspace or ArrowLeft with a modifier ends it and runs as usual.'
	},
	{
		file: 'components/blocks/text/widget-interaction.ts',
		claims: { scope: 'leaf', chords: ['Shift+ArrowLeft', 'Shift+ArrowRight'] },
		keys: [
			'Arrow*',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'Delete',
			'Escape'
		],
		note: 'Extends a selection into a widget. A modified arrow is also swallowed while a widget is selected, but that is a caret-coherence guard in a transient state, not a binding; a plain vertical arrow, a line-edge key or a page key places a caret and declines.'
	},
	{
		file: 'components/image/ImageResizeHandles.svelte',
		keys: [],
		note: 'Shift locks the aspect ratio during a pointer drag.'
	},
	{
		file: 'components/image/image-press.ts',
		keys: [],
		note: 'A Shift-press on a block is left to that block, which grows a range from the image.'
	},
	{
		file: 'components/image/image-widget-editing.ts',
		claims: { scope: 'leaf', chords: ['Shift+ArrowLeft', 'Shift+ArrowRight'] },
		keys: ['ArrowLeft', 'ArrowRight'],
		note: 'Keyboard resize of the selected image.'
	},
	{
		file: 'components/image/widget-dom.ts',
		keys: [],
		note: 'Shift-click declines, so the block keeps cross-block extension.'
	},
	{
		file: 'caret/edge-affinity.ts',
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'End',
			'Home',
			'PageDown',
			'PageUp',
			'Process',
			'Unidentified'
		],
		note: 'Classifies keys for the caret memory and consumes none: only a plain arrow crosses a code chip’s border, so the modifier reads there are a refusal.'
	},
	{
		file: 'editor-actions/caret-host-input.ts',
		keys: ['Enter'],
		note: 'A plain key that ended a composition the browser dropped in the gap caret or a block focused whole is spent there, Enter opening the paragraph after the composed one; a chord goes on to the host.'
	},
	{
		file: 'editor-actions/container-block-component.ts',
		claims: { scope: 'whole-block', chords: ['Mod+C', 'Mod+X'] },
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
		note: 'Whole-block copy/cut: a keydown carries no ClipboardEvent, so the chord is read here. The unchorded printable creates a paragraph below, so the same modifier reads gate that branch too. The arrow exit for a plugin editor or a hand-built view declines every modified key rather than claiming one.'
	},
	{
		file: 'plugins/mermaid/MermaidBlock.svelte',
		claims: { scope: ['mermaid'], chords: ['Mod+Enter'] },
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', 'Escape', 'Tab'],
		note: 'Commits the diagram edit; the arrows are the edit box’s boundary exits, and a modified one is declined rather than claimed. Taken only in a diagram block, which exists only where the plugin is listed, so `reservedChords()` lists it unconditionally: the table keymap binds it anyway.'
	},
	{
		file: 'schema/keybindings.ts',
		claims: {
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
		keys: [
			'A',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'Delete',
			'End',
			'Home',
			'PageDown',
			'PageUp'
		],
		note: "The normalizer every other site reads, the select-all predicate every block asks, the caret-edge reader every edge site asks, and the page-key reader, which leaves Ctrl, Cmd and Alt with a page key to the browser. Its sites take Shift+Home and Mod+Home behind a marker or a leading widget, Mod+End before a trailing widget, Cmd+Right past a code chip and Cmd+Left from a selected widget; Mod+Shift+Home and Mod+Shift+End always extend to the document's edge. Its Cmd+Arrow chords (macOS's Home and End) are `CMD_EDGE_CHORDS` below, since the chord form cannot tell Cmd from Ctrl."
	},
	{
		file: 'selection/cross-block/keydown.ts',
		claims: {
			scope: 'range',
			chords: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight']
		},
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'B',
			'Backspace',
			'Delete',
			'E',
			'Escape',
			'I',
			'K',
			'Tab',
			'X',
			'b',
			'e',
			'i',
			'k',
			'x'
		],
		note: 'Enter and Mod+0-6 are claimed over a range by what the keymap binds them to, not here. The rewrite chords are claimed over a cross-block range and handed to the cross-block dispatch: the four format toggles route to the cross-block handler, and the link card declines, since no single block can hold the link it would create. Falling through read the chord as text (or ran Ctrl+K as kill-line). Mod+Shift+X takes a branch of its own: unshifted Mod+X is the whole-block cut.'
	},
	{
		file: 'selection/cross-block/pointer.ts',
		keys: [],
		note: 'Shift-click anchoring.'
	},
	{
		file: 'selection/dead-space-caret.ts',
		keys: [],
		note: 'A modified click is a platform command, so the dead-space caret declines it.'
	},
	{
		file: 'selection/motion-keys.ts',
		keys: [],
		note: 'Its caret keys are read by motionKey (schema/keybindings.ts); a vertical arrow with Ctrl or Cmd is left to the browser’s own move.'
	},
	{
		file: 'selection/shared-keydown.ts',
		claims: {
			scope: 'leaf',
			chords: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight']
		},
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'],
		note: 'Extends across a block boundary once the native extend runs out of room. Its block-edge chords are read by caretEdgeKey (schema/keybindings.ts).'
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
	HARDCODED_CHORD_SITES.flatMap((site) => site.claims?.chords ?? [])
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
	return HARDCODED_CHORD_SITES.some(({ claims }) => {
		if (!claims || !claims.chords.includes(chord) || (reading && !claims.inReading)) return false;
		return inScope(claims.scope);
	});
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
