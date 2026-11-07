/**
 * The spelling menu a hover opens: the suggestions alone, under the misspelled word the pointer
 * rests on, and the same menu from the keyboard through `decorations.activateAtCaret`. The
 * pointer must rest on the word a while first, so passing over prose opens nothing, and a hover
 * ending starts a short grace, so the pointer can travel from the word onto the menu.
 */

import type { MarkInteractions } from '../../decorations/types';
import type { Misspelling } from '../../spell/spell-state.svelte';

/** How long the pointer rests on a word before its menu opens. */
export const HOVER_OPEN_MS = 800;
/** How long the menu outlives the hover that opened it, for the pointer to reach it. */
export const HOVER_GRACE_MS = 300;

/** The spelling menu once opened; `isOpen` goes false when any other route closes it. */
export interface SpellMenuHandle {
	isOpen(): boolean;
	close(): void;
}

export interface SpellHoverDeps {
	open(misspelling: Misspelling, anchor: DOMRect): SpellMenuHandle | null;
	/** Whether another menu is showing, which a hover never replaces. */
	menusOpen(): boolean;
	/** Whether a range is selected, where the selection toolbar is the spelling's home. */
	rangeSelected(): boolean;
	/** Whether the pointer rests on the open menu now. */
	pointerOnMenu(): boolean;
}

export interface SpellHover {
	/** The handlers a misspelled word's mark carries. */
	interactions(misspelling: Misspelling): MarkInteractions;
	/** The pointer left the open menu: it closes after the grace, unless a hover takes it back. */
	menuLeft(): void;
	dispose(): void;
}

type Timer = ReturnType<typeof setTimeout>;

export function createSpellHover(deps: SpellHoverDeps): SpellHover {
	let menu: SpellMenuHandle | null = null;
	let shown: Misspelling | null = null;
	let opening: Timer | null = null;
	let closing: Timer | null = null;

	function cancelOpen(): void {
		if (opening !== null) clearTimeout(opening);
		opening = null;
	}

	function cancelClose(): void {
		if (closing !== null) clearTimeout(closing);
		closing = null;
	}

	function open(misspelling: Misspelling, anchor: DOMRect): void {
		cancelOpen();
		cancelClose();
		// Back onto the word whose menu is showing (from the menu, say): nothing to reopen.
		if (menu?.isOpen() && shown && sameWord(shown, misspelling)) return;
		if (deps.menusOpen() && !menu?.isOpen()) return;
		menu?.close();
		menu = deps.open(misspelling, anchor);
		shown = menu ? misspelling : null;
	}

	// Both timers are wall-clock (G4.4 allowlist): how long the pointer rests, and how long its
	// travel from the word to the menu takes.
	function openAfterRest(misspelling: Misspelling, anchor: DOMRect): void {
		cancelClose();
		if (menu?.isOpen() && shown && sameWord(shown, misspelling)) return;
		cancelOpen();
		opening = setTimeout(() => {
			opening = null;
			if (deps.rangeSelected()) return;
			open(misspelling, anchor);
		}, HOVER_OPEN_MS);
	}

	function closeAfterGrace(): void {
		cancelClose();
		closing = setTimeout(() => {
			closing = null;
			if (deps.pointerOnMenu()) return;
			menu?.close();
			menu = null;
		}, HOVER_GRACE_MS);
	}

	return {
		interactions(misspelling) {
			return {
				onHover: (_dec, hover) => {
					if (hover) return openAfterRest(misspelling, hover.anchor);
					cancelOpen();
					if (menu?.isOpen()) closeAfterGrace();
				},
				onActivate: (_dec, { anchor }) => open(misspelling, anchor)
			};
		},
		menuLeft() {
			if (menu?.isOpen()) closeAfterGrace();
		},
		dispose() {
			cancelOpen();
			cancelClose();
			menu?.close();
			menu = null;
		}
	};
}

function sameWord(a: Misspelling, b: Misspelling): boolean {
	return (
		a.start === b.start &&
		a.end === b.end &&
		a.path.length === b.path.length &&
		a.path.every((step, i) => step === b.path[i])
	);
}
