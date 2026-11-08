/**
 * When the spelling menu a hover opens shows and hides: the pointer rests on a misspelled word a
 * while before it opens, so passing over prose opens nothing, and a hover ending starts a short
 * grace, so the pointer can travel from the word onto the menu. The keyboard route opens at once.
 */

import type { Misspelling } from './words';

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
	/** The pointer came onto a misspelled word (its rect), or left it (null). */
	hover(misspelling: Misspelling, anchor: DOMRect | null): void;
	/** The keyboard asked for the word's menu. */
	activate(misspelling: Misspelling, anchor: DOMRect): void;
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

	const showing = (misspelling: Misspelling): boolean =>
		!!menu?.isOpen() && !!shown && sameWord(shown, misspelling);

	function open(misspelling: Misspelling, anchor: DOMRect): void {
		cancelOpen();
		cancelClose();
		// Back onto the word whose menu is showing (from the menu, say): nothing to reopen.
		if (showing(misspelling)) return;
		if (deps.menusOpen() && !menu?.isOpen()) return;
		menu?.close();
		menu = deps.open(misspelling, anchor);
		shown = menu ? misspelling : null;
	}

	// Both timers are wall-clock, allowed by the timer scan: how long the pointer rests, and how
	// long its travel from the word to the menu takes.
	function openAfterRest(misspelling: Misspelling, anchor: DOMRect): void {
		cancelClose();
		if (showing(misspelling)) return;
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
		hover(misspelling, anchor) {
			if (anchor) return openAfterRest(misspelling, anchor);
			cancelOpen();
			if (menu?.isOpen()) closeAfterGrace();
		},
		activate: open,
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

const sameWord = (a: Misspelling, b: Misspelling): boolean => a.from === b.from && a.to === b.to;
