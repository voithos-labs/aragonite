/**
 * Editor-root chord routing for keystrokes no mounted block handled. Search and Escape run
 * first: the global-chord branch returns early on its focus check, which would swallow a Mod+F
 * pressed inside a block (`test/editor-root/keydown.test.ts` pins the order).
 */

import { claimsBodyChord, isForeignTextEntry, isTextEntrySurface } from '../../active-editor';
import type { SearchState } from '../../search/search-state.svelte';
import type { CrossBlockHandlers } from '../../selection/cross-block/dispatch';
import type { CommandDispatchContext } from '../../schema/block-commands';
import { isReservedUiChord, runGlobalChord } from '../../schema/commands';
import { eventToChord, isCharacterKey } from '../../schema/keybindings';
import { shownSelectionText } from '../../browser/selection-read';

export interface EditorRootKeydownDeps {
	/** Getters, never values: capturing them would freeze the flags at construction time. */
	get searchBarEnabled(): boolean;
	/** One predicate, so the root Mod+H and the bar's chevron cannot diverge on when
	 *  the replace row may open. */
	get canReplace(): boolean;
	get isCrossBlock(): boolean;
	search: SearchState;
	/** The editor's command dispatch, which takes only this instance's plugins' chords. */
	commands: CommandDispatchContext;
	crossBlock: Pick<CrossBlockHandlers, 'handleKeyDown' | 'insertText'>;
	/** True for nodes in the host's own header: they sit inside `root.contains`
	 *  without being the editor's own content. */
	isHostChrome(node: Node | null): boolean;
	/** True for nodes in this editor's find bar, which the host can mount outside the root. */
	isFindBar(node: Node | null): boolean;
	/** Snapshot the pre-search selection; the bar's close handler restores it. */
	saveSearchCaret(): void;
	setReplaceExpanded(expanded: boolean): void;
}

export interface EditorRootKeydown {
	/** `root` is the element the installing effect captured, not a live binding: a
	 *  teardown that nulled the component's reference must not reach here. */
	handleKeyDown(event: KeyboardEvent, root: HTMLElement): void;
}

export function createEditorRootKeydown(deps: EditorRootKeydownDeps): EditorRootKeydown {
	const focusInEditor = (root: HTMLElement, active: Element | null): boolean =>
		root.contains(active) || deps.isFindBar(active);

	/** Search and Escape, with focus in this editor or a search chord this instance holds; a text
	 *  field outside every editor keeps page-wide Find while the user types in it. */
	function handleSearchChords(
		event: KeyboardEvent,
		root: HTMLElement,
		chord: string | null,
		active: Element | null
	): boolean {
		if (!(focusInEditor(root, active) || (claimsBodyChord(root) && !isForeignTextEntry(active))))
			return false;

		if (deps.searchBarEnabled && chord && isReservedUiChord(chord)) {
			event.preventDefault();
			// Read before open(), whose focus collapses the selection; the !isOpen check keeps a
			// repeat Mod+F from overwriting the saved caret.
			const selected = shownSelectionText();
			if (!deps.search.isOpen) deps.saveSearchCaret();
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

	/** Undo, redo, plugin-global chords and cross-block motion need no element focused, since an
	 *  outside one may own them (a text input owns Mod+Z); the gap caret handles its own. */
	function ownsWindowedOutCaret(root: HTMLElement, active: Element | null): boolean {
		const noElementFocused = active === null || active === root.ownerDocument.body;
		return active === root || (noElementFocused && claimsBodyChord(root));
	}

	/** WebKit goes back in history on a Backspace outside a field, and in reading mode every block
	 *  is outside one. Any input keeps the key, since a date input deletes on it too. */
	function keepPageOnBackspace(event: KeyboardEvent, root: HTMLElement, active: Element | null) {
		if (event.key !== 'Backspace' || isTextEntrySurface(active)) return;
		if (active instanceof HTMLInputElement) return;
		if (focusInEditor(root, active) || ownsWindowedOutCaret(root, active)) event.preventDefault();
	}

	/** Editor chrome (a toolbar button, a menu item) holds focus and has no keymap, so the editor's
	 *  global chords answer there; a field owns its own Mod+Z, and a block that took the key ran it. */
	function chromeHoldsFocus(event: KeyboardEvent, root: HTMLElement, active: Element | null) {
		return (
			active !== null &&
			active !== root &&
			focusInEditor(root, active) &&
			!isTextEntrySurface(active) &&
			!event.defaultPrevented
		);
	}

	return {
		handleKeyDown(event, root) {
			// Normalizes the key (CapsLock uppercases e.key without Shift), matching
			// every other chord-dispatch site.
			const chord = eventToChord(event);
			const active = root.ownerDocument.activeElement;

			// The host's header owns its keystrokes; `isForeignTextEntry` cannot tell, since the
			// header is inside the editor.
			if (deps.isHostChrome(active)) return;
			keepPageOnBackspace(event, root, active);

			if (handleSearchChords(event, root, chord, active)) return;
			const ownsCaret = ownsWindowedOutCaret(root, active);
			if (!ownsCaret && !chromeHoldsFocus(event, root, active)) return;

			// No block is focused here, so resolve globally, overrides included, or a consumer's
			// global rebind would be dead in this one place. Prevented, so no engine runs its own undo.
			if (chord && runGlobalChord(chord, deps.commands)) {
				event.preventDefault();
				return;
			}

			if (!ownsCaret || !deps.isCrossBlock) return;

			// With nothing editable focused, no `beforeinput` fires for a typed character, so it
			// comes in here; composition and chorded keys are left alone.
			if (isCharacterKey(event.key) && !event.isComposing && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				void deps.crossBlock.insertText(event.key);
				return;
			}

			void deps.crossBlock.handleKeyDown(event);
		}
	};
}
