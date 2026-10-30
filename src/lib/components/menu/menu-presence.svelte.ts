/**
 * The editor's open menus: whether any is showing, which is what `menuChange` reports, and the one
 * place a menu closes from outside itself. Every menu attaches `track(close)` to its root element,
 * so it reads open for exactly as long as it is mounted, and a press outside it or an Escape closes
 * it without the menu or its opener ever holding focus (Safari never focuses a clicked button).
 */

import { imeOwnsKey } from '../../browser/composition';
import { tick, untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { assertInvariant, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { checkMenuClosed } from '../../invariants/menu-closes';

/** Why a menu is closing. A swap runs once the new document is in place, so a menu holding a draft
 *  must drop it then; a mode change can still save it. */
export type MenuCloseCause = 'mode-change' | 'document-swap' | 'escape-key' | 'outside-press';

/** A menu's own close. It returns whether the menu takes the key that closed it: only Escape reads
 *  the answer, and a taken Escape reaches nothing else. */
export type MenuClose = (cause: MenuCloseCause) => boolean;

export interface MenuTrackOptions {
	/** Marks a menu whose rows write, which closes at once if it opens in reading mode. */
	edits?: boolean;
	/** Elements a press on is not outside the menu: the button that toggles it, the panel a
	 *  flyout hangs off. */
	inside?: () => readonly (Element | null | undefined)[];
}

export interface MenuPresence {
	/** A getter, so a reader re-runs when a menu opens or closes. */
	readonly isOpen: boolean;
	/** Whether a press of Escape now goes to a menu, an uncounted one included. */
	readonly takesEscape: boolean;
	/** Attach to a menu's root element with the menu's own close. */
	track(close: MenuClose, opts?: MenuTrackOptions): Attachment;
	/** As `track`, for a popover that hangs off chrome which itself steps aside on `menuChange`:
	 *  it closes the same way but never reads as an open menu. */
	trackUncounted(close: MenuClose, opts?: MenuTrackOptions): Attachment;
	/** Close every open menu: a document swap and a mode change call it. */
	closeAll(cause: MenuCloseCause): void;
}

export interface MenuPresenceDeps {
	isReading(): boolean;
}

export const MENU_OPENED_IN_READING = 'menu-opened-in-reading';

interface OpenMenu {
	close: MenuClose;
	el: Element;
	inside?: () => readonly (Element | null | undefined)[];
}

export function createMenuPresence(deps: MenuPresenceDeps): MenuPresence {
	// A count beside the list, so two menus overlapping still read as one open.
	let count = $state(0);
	// In opening order: Escape closes the newest, so a flyout goes before the menu it hangs off.
	const open: OpenMenu[] = [];

	function closeMenu(menu: OpenMenu, cause: MenuCloseCause): boolean {
		const taken = menu.close(cause);
		void tick().then(() =>
			assertInvariant('menu-closes', () => checkMenuClosed(open.includes(menu), cause))
		);
		return taken;
	}

	function contains(menu: OpenMenu, target: Node): boolean {
		return (
			menu.el.contains(target) || (menu.inside?.().some((el) => el?.contains(target)) ?? false)
		);
	}

	const onPointerDown = (e: PointerEvent) => {
		const target = e.target instanceof Node ? e.target : null;
		for (const menu of open.filter((m) => !target || !contains(m, target))) {
			closeMenu(menu, 'outside-press');
		}
	};
	const onKeyDown = (e: KeyboardEvent) => {
		// A composing Escape cancels the IME's conversion, not a menu.
		if (e.key !== 'Escape' || imeOwnsKey(e)) return;
		const newest = open.at(-1);
		if (!newest || !closeMenu(newest, 'escape-key')) return;
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	// At the document in the capture phase: focus may sit on `body`, and the menu answers before
	// the block under the caret does.
	function listen(): void {
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
	}
	function unlisten(): void {
		document.removeEventListener('pointerdown', onPointerDown, true);
		document.removeEventListener('keydown', onKeyDown, true);
	}

	function attach(close: MenuClose, opts: MenuTrackOptions | undefined, counted: boolean) {
		return (el: Element) => {
			const menu: OpenMenu = { close, el, inside: opts?.inside };
			// Untracked, or the attachment would depend on the count it writes and rerun forever.
			untrack(() => {
				if (open.length === 0) listen();
				open.push(menu);
				if (counted) count++;
				if (opts?.edits && deps.isReading()) {
					devWarn(MENU_OPENED_IN_READING, 'a menu whose rows write opened in reading mode');
					// The mode is what rules the menu out, as when one changes under it.
					closeMenu(menu, 'mode-change');
				}
			});
			return () =>
				untrack(() => {
					open.splice(open.indexOf(menu), 1);
					if (counted) count--;
					if (open.length === 0) unlisten();
				});
		};
	}

	return {
		get isOpen() {
			return count > 0;
		},
		get takesEscape() {
			return open.length > 0;
		},
		track: (close, opts) => attach(close, opts, true),
		trackUncounted: (close, opts) => attach(close, opts, false),
		closeAll(cause) {
			untrack(() => {
				for (const menu of [...open]) closeMenu(menu, cause);
			});
		}
	};
}
