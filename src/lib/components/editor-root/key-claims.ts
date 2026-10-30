/**
 * Whether the editor takes a keystroke where it lands, the answer behind `claimsChord`. It asks
 * the questions each keydown handler on the key's way asks, through the resolvers those handlers
 * call, so a host's own shortcut runs exactly where the editor would do nothing with the key.
 */

import { imeOwnsKey } from '../../browser/composition';
import type { InlineMenuState } from '../../inline-menu/inline-menu-state.svelte';
import type { AnyBlockKind, Document } from '../../core/nodes';
import type { ContainerChords } from '../../editor-actions/container-chords';
import type { GapCaretPosition } from '../../selection/gap-caret';
import { isEditableEventTarget } from '../../editor-actions/whole-block-focus-surface.svelte';
import { isReadingMode } from '../../presentation-mode';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { leafKeyCommandRuns, type CommandDispatchContext } from '../../schema/block-commands';
import {
	isDefaultGlobalChord,
	isReservedUiChord,
	resolveBinding,
	takesGlobalChord,
	takesGlobalChordOnKind
} from '../../schema/commands';
import { eventToChord, isCharacterKey, isPasteKey, textKeyRole } from '../../schema/keybindings';
import { wholeBlockClipboardKey } from '../../editor-actions/container-block-component';
import { rangeOwnsKey } from '../../selection/cross-block/keydown';
import { findSurfacePathForElement } from '../../selection/path-lookup';
import type { SelectionState } from '../../selection/selection-state.svelte';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import {
	chromeHoldsFocus,
	focusInEditor,
	keepsPageOnBackspace,
	keyTargetOf,
	ownsWindowedOutCaret,
	searchChordsReach,
	type KeyFocusDeps
} from './key-focus';

export interface KeyClaimsDeps extends KeyFocusDeps {
	/** Getters, never values: each reads the live instance. */
	root(): HTMLElement | undefined;
	searchBarEnabled(): boolean;
	searchOpen(): boolean;
	/** An open block menu, context menu or link card, which holds a focus trap. */
	menusOpen(): boolean;
	/** An open menu, the crop or a toolbar flyout, which closes on Escape wherever the caret is. */
	menuTakesEscape(): boolean;
	/** The rows under the caret, which step and pick on their keys before any block sees them. */
	inlineMenu: Pick<InlineMenuState, 'listKey'>;
	/** The chord an open link card swallows: the one that opens it. */
	opensLinkCard(e: KeyboardEvent): boolean;
	selection: Pick<SelectionState, 'gapCaret' | 'isCrossBlock' | 'anchor' | 'focus'>;
	containerChords: Pick<ContainerChords, 'takes'>;
	getDoc(): Document;
	commands: CommandDispatchContext;
}

/** Where a keystroke lands, as the editor's keydown handlers meet it. */
export type KeyFocus =
	| { at: 'host-chrome' }
	| { at: 'outside' }
	| { at: 'root' }
	| { at: 'find-bar' }
	| { at: 'gap'; gap: GapCaretPosition }
	| { at: 'leaf' | 'whole-block' | 'plugin-editor'; kind: AnyBlockKind; path: number[] }
	| { at: 'field'; path: number[] | null }
	| { at: 'control'; kind?: AnyBlockKind; path: number[] | null };

export interface KeyClaims {
	readKeyFocus(e: KeyboardEvent): KeyFocus;
	takesKey(e: KeyboardEvent, focus: KeyFocus): boolean;
	/** `takesKey` at the focus `readKeyFocus` finds: `claimsChord`. */
	claims(e: KeyboardEvent): boolean;
}

export function createKeyClaims(deps: KeyClaimsDeps): KeyClaims {
	const reading = () => isReadingMode(deps.commands.getPresentationMode);
	const rangeTakes = (e: KeyboardEvent) =>
		deps.selection.isCrossBlock && rangeOwnsKey(e, { ...deps, commands: deps.commands });

	/** A chord the focused block's keymap, or a container's around it, runs here: the containers
	 *  answer through the same walk their dispatch takes. */
	function keymapTakes(
		e: KeyboardEvent,
		chord: string,
		kind: AnyBlockKind,
		path: readonly number[],
		leaf: boolean
	): boolean {
		const { commands } = deps;
		const overrides = commands.keybindingOverrides();
		const bound = leaf ? resolveBinding(chord, kind, overrides, commands.activation) : null;
		if (bound && leafKeyCommandRuns(bound.command, kind, commands)) return true;
		return deps.containerChords.takes(e, path);
	}

	/** The editor root's own keys, which reach it from wherever focus is in the editor. */
	function rootTakes(
		e: KeyboardEvent,
		chord: string | null,
		root: HTMLElement,
		el: Element | null
	) {
		if (e.key === 'Backspace' && keepsPageOnBackspace(root, el, deps)) return true;
		if (root.contains(el) && deps.inlineMenu.listKey(e) !== null) return true;
		if (e.key === 'Escape' && deps.menuTakesEscape()) {
			if (focusInEditor(root, el, deps) || ownsWindowedOutCaret(root, el)) return true;
		}
		if (searchChordsReach(root, el, deps)) {
			if (deps.searchBarEnabled() && chord && isReservedUiChord(chord)) return true;
			if (e.key === 'Escape' && deps.searchOpen()) return true;
		}
		const ownsCaret = ownsWindowedOutCaret(root, el);
		if (!ownsCaret && !chromeHoldsFocus(root, el, deps)) return false;
		if (chord && takesGlobalChord(chord, deps.commands)) return true;
		if (!ownsCaret || !deps.selection.isCrossBlock) return false;
		return (isCharacterKey(e.key) && !e.ctrlKey && !e.metaKey) || rangeTakes(e);
	}

	function leafTakes(e: KeyboardEvent, chord: string | null, kind: AnyBlockKind, path: number[]) {
		if (rangeTakes(e)) return true;
		const role = textKeyRole(e);
		if (role === 'reads' || (role === 'writes' && !reading())) return true;
		if (chord === null) return false;
		if (isDefaultGlobalChord(chord, deps.commands.activation)) return true;
		return keymapTakes(e, chord, kind, path, true);
	}

	function wholeBlockTakes(
		e: KeyboardEvent,
		chord: string | null,
		kind: AnyBlockKind,
		path: number[]
	) {
		if (chord && takesGlobalChordOnKind(chord, kind, deps.commands)) return true;
		if (chord && keymapTakes(e, chord, kind, path, true)) return true;
		if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') return true;
		if (wholeBlockClipboardKey(e) && !deps.selection.isCrossBlock) return true;
		if (isPasteKey(e)) return !reading();
		if (e.ctrlKey || e.metaKey || e.altKey) return false;
		return isCharacterKey(e.key) || e.key.startsWith('Arrow');
	}

	function gapTakes(e: KeyboardEvent, chord: string | null, gap: GapCaretPosition) {
		if (chord && takesGlobalChord(chord, deps.commands)) return true;
		if (deps.containerChords.takes(e, [...gap.parentPath, gap.index])) return true;
		if (isPasteKey(e)) return !reading();
		if (e.ctrlKey || e.metaKey || e.altKey) return false;
		if (GAP_KEYS.has(e.key)) return true;
		return isCharacterKey(e.key) && !reading();
	}

	/** A text field the editor shows (a link card's URL, a hand-built view's own field): its own
	 *  editing keys, an open card's focus trap, and the chords of the containers around it. */
	function fieldTakes(e: KeyboardEvent, el: Element, path: number[] | null) {
		if (textKeyRole(e) !== null) return true;
		if (path && deps.containerChords.takes(e, path)) return true;
		if (deps.menusOpen() && FIELD_MENU_KEYS.has(e.key)) return true;
		return !!el.closest('[data-link-card]') && deps.opensLinkCard(e);
	}

	/** The editor of a plugin's block focused as a whole (a diagram's source box), which keeps
	 *  every key it reads to itself: its text keys, and Enter, Tab and Escape however modified. */
	function pluginEditorTakes(e: KeyboardEvent) {
		return textKeyRole(e) !== null || PLUGIN_EDITOR_KEYS.has(e.key);
	}

	/** A control the editor shows (a menu item, a button in a block): an open menu's keys, and a
	 *  plain arrow out of a block, which every block takes as its exit. */
	function controlTakes(
		e: KeyboardEvent,
		chord: string | null,
		el: Element,
		kind: AnyBlockKind | null,
		path: number[] | null
	) {
		if (menuTakes(e, MENU_KEYS)) return true;
		if (el.closest('[data-link-card]') && deps.opensLinkCard(e)) return true;
		if (kind === null || path === null) return false;
		if (chord && keymapTakes(e, chord, kind, path, false)) return true;
		const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
		return plain && e.key.startsWith('Arrow');
	}

	/** An open menu reads its keys unmodified, Shift+Tab aside. */
	function menuTakes(e: KeyboardEvent, keys: ReadonlySet<string>): boolean {
		return deps.menusOpen() && !e.ctrlKey && !e.metaKey && !e.altKey && keys.has(e.key);
	}

	/** Where a keystroke lands, read off the DOM as its handlers would meet it. */
	function readKeyFocus(e: KeyboardEvent): KeyFocus {
		const root = deps.root();
		if (!root) return { at: 'outside' };
		const el = keyTargetOf(e, root, deps);
		if (deps.isHostChrome(el)) return { at: 'host-chrome' };
		if (el === root || ownsWindowedOutCaret(root, el)) return { at: 'root' };
		if (!el || !focusInEditor(root, el, deps)) return { at: 'outside' };
		if (deps.isFindBar(el)) return { at: 'find-bar' };
		const gap = deps.selection.gapCaret;
		if (gap && el.closest('[data-gap-caret]')) return { at: 'gap', gap };
		const path = findSurfacePathForElement(el);
		const kind = (path && blockNodeAt(deps.getDoc(), path)?.kind) ?? null;
		const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
		if (path === null || kind === null) return { at: field ? 'field' : 'control', path: null };
		if (tryGetBlockKindDescriptor(kind)?.blockFocus === 'whole-block') {
			return isEditableEventTarget(el)
				? { at: 'plugin-editor', kind, path }
				: { at: 'whole-block', kind, path };
		}
		if (field) return { at: 'field', path };
		if (el.hasAttribute('contenteditable')) return { at: 'leaf', kind, path };
		return { at: 'control', kind, path };
	}

	/** Whether the editor takes `e` at `focus`: the one decision `claimsChord` reads. */
	function takesKey(e: KeyboardEvent, focus: KeyFocus): boolean {
		const root = deps.root();
		if (!root || focus.at === 'host-chrome') return false;
		const el = keyTargetOf(e, root, deps);
		if (imeOwnsKey(e)) return focusInEditor(root, el, deps);
		const chord = eventToChord(e);
		if (rootTakes(e, chord, root, el)) return true;
		switch (focus.at) {
			case 'root':
			case 'outside':
				return false;
			case 'find-bar':
				return textKeyRole(e) !== null || e.key === 'Enter' || e.key === 'Escape';
			case 'gap':
				return gapTakes(e, chord, focus.gap);
			case 'plugin-editor':
				return pluginEditorTakes(e);
			case 'whole-block':
				return wholeBlockTakes(e, chord, focus.kind, focus.path);
			case 'leaf':
				return leafTakes(e, chord, focus.kind, focus.path);
			case 'field':
				return fieldTakes(e, el!, focus.path);
			case 'control':
				return controlTakes(e, chord, el!, focus.kind ?? null, focus.path);
		}
	}

	return { readKeyFocus, takesKey, claims: (e) => takesKey(e, readKeyFocus(e)) };
}

// The gap caret's own exits and the Enter that opens a block there.
const GAP_KEYS = new Set([
	'Enter',
	'ArrowDown',
	'ArrowRight',
	'ArrowUp',
	'ArrowLeft',
	'Backspace',
	'Delete',
	'Escape'
]);

// A plugin's own editor reads these itself, modified or not.
const PLUGIN_EDITOR_KEYS = new Set(['Enter', 'Tab', 'Escape']);

// An open card's field takes its focus trap and its Enter, modified or not.
const FIELD_MENU_KEYS = new Set(['Enter', 'Tab']);

// An open menu steps and picks.
const MENU_KEYS = new Set([
	'ArrowDown',
	'ArrowUp',
	'ArrowLeft',
	'ArrowRight',
	'Home',
	'End',
	'Enter',
	'Tab'
]);
