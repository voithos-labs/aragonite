/**
 * Editor-root chord routing: the dispatch for keystrokes no mounted block
 * consumed. Pure dispatch over live getters — the `$effect` that installs the
 * listener stays in `Editor.svelte`, which also captures the root element and
 * hands it in per event rather than exposing it as a re-read binding.
 *
 * Arm order is load-bearing (pinned by `test/editor-root-keydown.test.ts`): the
 * search/Escape arm runs FIRST because the global-chord arm's focus gate is an
 * unconditional early return for everything below it, so a Mod+F pressed with the
 * caret inside a block would be swallowed if the two swapped.
 */

import { claimsBodyChord, isForeignTextEntry } from '../active-editor';
import type { PluginEditorLookup } from '../editor-keys';
import type { PresentationMode } from '../presentation-mode';
import type { SearchState } from '../search/search-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block/dispatch';
import type { CommandErrorSink } from '../schema/block-commands';
import type { KeybindingOverrideMap } from '../schema/keybinding-overrides';
import {
	getCommand,
	isEditorGlobalChord,
	isReservedUiChord,
	resolveGlobalBinding,
	type GlobalCommandContext
} from '../schema/commands';
import { eventToChord } from '../schema/keybindings';

export interface EditorRootKeydownDeps {
	/** Live reads arrive as getters — a captured value would freeze the
	 *  reading-mode gate and the override map at construction time. */
	get searchBarEnabled(): boolean;
	get mode(): PresentationMode;
	/** The editor's one replace predicate, threaded so the root Mod+H and the
	 *  bar's chevron cannot diverge on when the replace row may open. */
	get canReplace(): boolean;
	get keybindingOverrides(): KeybindingOverrideMap;
	get isCrossBlock(): boolean;
	search: SearchState;
	history: GlobalCommandContext['history'];
	pluginEditor: PluginEditorLookup;
	onCommandError: CommandErrorSink;
	crossBlock: Pick<CrossBlockHandlers, 'handleKeyDown'>;
	/** Snapshot the pre-search caret; the bar's close handler restores it. */
	saveSearchRange(range: Range | null): void;
	setReplaceExpanded(expanded: boolean): void;
}

export interface EditorRootKeydown {
	/** `root` is the element the installing effect captured, not a live binding —
	 *  a teardown that nulled the component's reference must not reach here. */
	handleKeyDown(event: KeyboardEvent, root: HTMLElement): void;
}

export function createEditorRootKeydown(deps: EditorRootKeydownDeps): EditorRootKeydown {
	/**
	 * Search / Escape: focus INSIDE this editor (a block, the find input, or the
	 * root), or a search chord this instance claims. claimsBodyChord is true for the
	 * sole editor (or, among several, the last-interacted one), so a lone editor
	 * claims Find/Replace page-wide — even with focus on a sibling toolbar control —
	 * restoring the pre-containment behavior; a second mounted editor can't steal it
	 * (an outside-focus Mod+F opens no bar when 2+ editors exist). The one exception:
	 * a foreign text-entry surface (a consumer's own <textarea>/<input>/
	 * contenteditable) owns page-global Find while the user types in it, so the
	 * editor yields there rather than hijacking it.
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
			// Seed the query from the live native selection before open() — focusing
			// the find input collapses it. Guard the saved-caret snapshot on !isOpen so
			// a repeat Mod+F (focus already in the find input) can't clobber the
			// pre-search caret with the collapsed one.
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
	 * Undo/redo, plugin-global chords and cross-block motion fire only when NO block
	 * holds focus: active === root (the caret's block windowed out and parked on THIS
	 * root, unique per editor), or nothing focused (body/null — windowed out and
	 * blurred to a page-shared target, claimed by the sole/last-interacted editor).
	 * Unlike the search chords, these collide with a focused outside element's native
	 * behavior — a text input owns Mod+Z — so they yield to any focused element and
	 * act only on the windowed-out caret.
	 */
	function ownsWindowedOutCaret(root: HTMLElement, active: Element | null): boolean {
		const noElementFocused = active === null || active === root.ownerDocument.body;
		return active === root || (noElementFocused && claimsBodyChord(root));
	}

	return {
		handleKeyDown(event, root) {
			// eventToChord normalizes the key (CapsLock uppercases e.key without
			// Shift), matching every other chord-dispatch site.
			const chord = eventToChord(event);
			const active = root.ownerDocument.activeElement;

			if (handleSearchChords(event, root, chord, active)) return;
			if (!ownsWindowedOutCaret(root, active)) return;

			// Undo/redo fire regardless of cross-block: the inert case is a collapsed
			// caret whose block unmounted, not necessarily a selection. No block is
			// focused here, so resolve at global scope (consumer override, else
			// default). This branch runs getCommand directly (no dispatchKeyCommand),
			// so it carries the reading-mode gate itself — sibling: ThematicBreakBlock.
			if (chord && isEditorGlobalChord(chord)) {
				event.preventDefault();
				if (deps.mode === 'reading') return;
				const binding = resolveGlobalBinding(chord, deps.keybindingOverrides);
				if (binding)
					getCommand(binding.command)?.({
						history: deps.history,
						pluginEditor: deps.pluginEditor,
						onCommandError: deps.onCommandError
					});
				return;
			}

			if (deps.isCrossBlock) void deps.crossBlock.handleKeyDown(event);
		}
	};
}
