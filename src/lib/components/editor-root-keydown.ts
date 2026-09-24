/**
 * Editor-root chord routing: dispatch for keystrokes no mounted block handled. Pure dispatch
 * over live getters; the installing `$effect` stays in `Editor.svelte`.
 *
 * The order below matters (`test/components/editor-root-keydown.test.ts` pins it): search and
 * Escape run first because the global-chord branch's focus check returns early no matter what,
 * which would swallow a Mod+F pressed with the caret inside a block.
 */

import { claimsBodyChord, isForeignTextEntry } from '../active-editor';
import type { PluginEditorLookup } from '../editor-keys';
import type { PluginActivation } from '../schema/plugin-activation';
import type { PresentationMode } from '../presentation-mode';
import type { SearchState } from '../search/search-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';
import type { CommandErrorSink } from '../schema/block-commands';
import type { KeybindingOverrideMap } from '../schema/keybinding-overrides';
import { isReservedUiChord, runGlobalChord, type GlobalCommandContext } from '../schema/commands';
import { eventToChord, isCharacterKey } from '../schema/keybindings';

export interface EditorRootKeydownDeps {
	/** Getters, never values: capturing them would freeze the reading-mode check and the
	 *  override map at construction time. */
	get searchBarEnabled(): boolean;
	get mode(): PresentationMode;
	/** One predicate, so the root Mod+H and the bar's chevron cannot diverge on when
	 *  the replace row may open. */
	get canReplace(): boolean;
	get keybindingOverrides(): KeybindingOverrideMap;
	get isCrossBlock(): boolean;
	search: SearchState;
	history: GlobalCommandContext['history'];
	pluginEditor: PluginEditorLookup;
	/** The plugins this instance activated, so the root takes only its own plugins' chords. */
	activation: PluginActivation;
	onCommandError: CommandErrorSink;
	crossBlock: Pick<CrossBlockHandlers, 'handleKeyDown' | 'insertText'>;
	/** True for nodes in the host's own header: they sit inside `root.contains`
	 *  without being the editor's own content. */
	isHostChrome(node: Node | null): boolean;
	/** Snapshot the pre-search caret; the bar's close handler restores it. */
	saveSearchRange(range: Range | null): void;
	setReplaceExpanded(expanded: boolean): void;
}

export interface EditorRootKeydown {
	/** `root` is the element the installing effect captured, not a live binding: a
	 *  teardown that nulled the component's reference must not reach here. */
	handleKeyDown(event: KeyboardEvent, root: HTMLElement): void;
}

export function createEditorRootKeydown(deps: EditorRootKeydownDeps): EditorRootKeydown {
	/**
	 * Search and Escape: focus inside this editor, or a search chord this instance takes.
	 * `claimsBodyChord` gives a lone editor Find and Replace page-wide while keeping a second
	 * mounted editor from stealing it. A text field outside every editor owns page-wide Find
	 * while the user types in it, so the editor stands aside there.
	 */
	function handleSearchChords(
		event: KeyboardEvent,
		root: HTMLElement,
		chord: string | null,
		active: Element | null
	): boolean {
		if (!(root.contains(active) || (claimsBodyChord(root) && !isForeignTextEntry(active))))
			return false;

		if (deps.searchBarEnabled && chord && isReservedUiChord(chord)) {
			event.preventDefault();
			// Read the query before open(): focusing the find input collapses the
			// selection. The !isOpen check keeps a repeat Mod+F from overwriting the
			// saved pre-search caret with the collapsed one.
			const selection = window.getSelection();
			const selected = selection?.toString() ?? '';
			if (!deps.search.isOpen) {
				deps.saveSearchRange(
					selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null
				);
			}
			deps.setReplaceExpanded(chord === 'Mod+H' && deps.canReplace);
			deps.search.open();
			if (selected) deps.search.setQuery(selected);
			return true;
		}

		if (event.key === 'Escape' && deps.search.isOpen) {
			event.preventDefault();
			deps.search.close();
			return true;
		}
		return false;
	}

	/**
	 * Undo, redo, plugin-global chords and cross-block motion fire only when no block holds
	 * focus: unlike the search chords, these collide with a focused outside element's own
	 * behavior (a text input owns Mod+Z). The gap caret has focused DOM of its own and handles
	 * the same chords there (`GapCaret.svelte`), so this stays out of its way.
	 */
	function ownsWindowedOutCaret(root: HTMLElement, active: Element | null): boolean {
		const noElementFocused = active === null || active === root.ownerDocument.body;
		return active === root || (noElementFocused && claimsBodyChord(root));
	}

	return {
		handleKeyDown(event, root) {
			// Normalizes the key (CapsLock uppercases e.key without Shift), matching
			// every other chord-dispatch site.
			const chord = eventToChord(event);
			const active = root.ownerDocument.activeElement;

			// The host's own header owns its keystrokes entirely. Checked once here rather
			// than in each branch; `isForeignTextEntry` cannot answer it, since it means
			// "outside every mounted editor" and the header is inside one.
			if (deps.isHostChrome(active)) return;

			if (handleSearchChords(event, root, chord, active)) return;
			if (!ownsWindowedOutCaret(root, active)) return;

			// No block is focused here, so resolve globally, overrides included, or a consumer's
			// global rebind would be dead in this one place. `runGlobalChord` applies the
			// reading-mode check and reports whether it handled the key.
			if (
				chord &&
				runGlobalChord(chord, deps.keybindingOverrides, {
					isReading: deps.mode === 'reading',
					history: deps.history,
					pluginEditor: deps.pluginEditor,
					activation: deps.activation,
					onCommandError: deps.onCommandError
				})
			) {
				event.preventDefault();
				return;
			}

			if (!deps.isCrossBlock) return;

			// A range whose blocks hold no character position leaves nothing editable focused, so
			// no `beforeinput` ever fires for a typed character and this is its only way in.
			// Composition still belongs to the browser, and a chorded key is not text.
			if (isCharacterKey(event.key) && !event.isComposing && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				void deps.crossBlock.insertText(event.key);
				return;
			}

			void deps.crossBlock.handleKeyDown(event);
		}
	};
}
