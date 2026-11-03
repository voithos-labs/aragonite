/**
 * Every library file that reads a KeyboardEvent modifier flag, with the key literals it compares
 * and the chords its own branches take: the G4.29 scan's evidence that each of those chords is one
 * `reservedChords()` lists, from a keymap or the text keys. A listed file keeps its literal key
 * comparisons and modifier reads. Test-only, so none of it ships.
 */

export interface HardcodedChordSite {
	/** Path under `src/lib`, or from the repo root for a bundled plugin's file. */
	file: string;
	/** Key literals the file compares. */
	keys: readonly string[];
	/** Modifier chords the file's own branches take. */
	takes?: readonly string[];
	/** Why the file's chords are what they are, where its branches alone don't say. */
	note?: string;
}

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
		takes: ['Shift+Enter'],
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
		takes: ['Shift+Tab'],
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
		takes: ['Shift+Tab'],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'Tab'],
		note: "Backwards step of the open menu's focus trap."
	},
	{
		file: 'components/blocks/table/TableCellBlock.svelte',
		takes: ['Shift+ArrowUp', 'Shift+ArrowDown'],
		keys: ['ArrowDown', 'ArrowUp', 'Enter'],
		note: 'Starts the intra-table rectangle before the prose extend can walk the next leaf.'
	},
	{
		file: 'components/blocks/table/cell-keydown-plan.ts',
		takes: ['Mod+ArrowUp', 'Mod+ArrowDown'],
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
		takes: ['Shift+ArrowLeft', 'Shift+ArrowRight'],
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
		file: 'components/image/ImageProperties.svelte',
		keys: ['Backspace', 'Delete', 'Enter', 'Escape', 'Tab'],
		note: 'A crop swallows the keys that would write over the image, which are the editor’s own; Shift reads whether a caret key resizes it: no keystroke is claimed here.'
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
		takes: ['Shift+ArrowLeft', 'Shift+ArrowRight'],
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
		keys: [
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'Backspace',
			'C',
			'Delete',
			'Enter',
			'X'
		],
		takes: ['Mod+C', 'Mod+X'],
		note: 'Whole-block copy/cut reads its chord off `eventToChord`, a keydown carrying no ClipboardEvent, and `claimsChord` asks the same predicate. The unchorded printable creates a paragraph below, so the same modifier reads gate that branch too. The arrow exit for a plugin editor or a hand-built view declines every modified key rather than claiming one.'
	},
	{
		file: 'packages/mermaid/src/MermaidBlock.svelte',
		takes: ['Mod+Enter'],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', 'Escape', 'Tab'],
		note: 'Commits the diagram edit; the arrows are the edit box’s boundary exits, and a modified one is declined rather than claimed. Taken only in a diagram block, which exists only where the plugin is listed, so `reservedChords()` lists it unconditionally: the table keymap binds it anyway.'
	},
	{
		file: 'schema/keybindings.ts',
		takes: [
			'Mod+A',
			'Shift+Home',
			'Mod+Home',
			'Mod+End',
			'Mod+Shift+Home',
			'Mod+Shift+End',
			'Shift+PageUp',
			'Shift+PageDown'
		],
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
			'Insert',
			'PageDown',
			'PageUp',
			'V'
		],
		note: "The normalizer every other site reads, the select-all predicate every block asks, the caret-edge reader every edge site asks, and the page-key reader, which leaves Ctrl, Cmd and Alt with a page key to the browser. Its sites take Shift+Home and Mod+Home behind a marker or a leading widget, Mod+End before a trailing widget, Cmd+Right past a code chip and Cmd+Left from a selected widget; Mod+Shift+Home and Mod+Shift+End always extend to the document's edge. Its Cmd+Arrow chords (macOS's Home and End) are `schema/reserved-chords.ts :: CMD_EDGE_CHORDS`, since the chord form cannot tell Cmd from Ctrl."
	},
	{
		file: 'selection/cross-block/keydown.ts',
		takes: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'],
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
		takes: ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'],
		keys: ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'],
		note: 'Extends across a block boundary once the native extend runs out of room. Its block-edge chords are read by caretEdgeKey (schema/keybindings.ts).'
	}
];
