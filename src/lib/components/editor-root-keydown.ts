/**
 * Editor-root chord routing: dispatch for keystrokes no mounted block consumed. Pure
 * dispatch over live getters; the installing `$effect` stays in `Editor.svelte`.
 *
 * Arm order is load-bearing (pinned by `test/components/editor-root-keydown.test.ts`): search /
 * Escape runs FIRST because the global-chord arm's focus gate is an unconditional
 * early return, which would swallow a Mod+F pressed with the caret inside a block.
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
import { eventToChord } from '../schema/keybindings';

export interface EditorRootKeydownDeps {
	/** Getters, never values: a capture freezes the reading-mode gate and the
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
	/** The plugins this instance activated, so the root claims only its own plugins'
	 *  chords. `undefined` = every installed plugin. */
	activation: PluginActivation | undefined;
	onCommandError: CommandErrorSink;
	crossBlock: Pick<CrossBlockHandlers, 'handleKeyDown'>;
	/** True for nodes in the host's `header` slot: they sit inside `root.contains`
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
	 * Search / Escape: focus inside this editor, or a search chord this instance
	 * claims. `claimsBodyChord` gives a lone editor Find/Replace page-wide while
	 * keeping a second mounted editor from stealing it. A foreign text-entry surface
	 * owns page-global Find while the user types in it, so the editor yields there.
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
			// Seed the query before open(): focusing the find input collapses the
			// selection. The !isOpen guard keeps a repeat Mod+F from clobbering the
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
	 * Undo/redo, plugin-global chords and cross-block motion fire only when no block holds focus:
	 * unlike the search chords, these collide with a focused outside element's native behavior (a
	 * text input owns Mod+Z). The gap caret's proxy is focused DOM of its own and resolves the same
	 * chords at the target (`GapCaret.svelte`), so this arm stays out of its way.
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

			// Host chrome owns its own keystrokes whole. The yield lives at the dispatch
			// entry rather than in each arm; `isForeignTextEntry` can't answer it, since
			// it means "outside every mounted editor" and the slot is inside one.
			if (deps.isHostChrome(active)) return;

			if (handleSearchChords(event, root, chord, active)) return;
			if (!ownsWindowedOutCaret(root, active)) return;

			// No block is focused here, so resolve at global scope — override tier included, or a
			// consumer's global rebind would be dead at this surface alone. The seam carries the
			// reading gate and answers whether the press was consumed.
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

			if (deps.isCrossBlock) void deps.crossBlock.handleKeyDown(event);
		}
	};
}
