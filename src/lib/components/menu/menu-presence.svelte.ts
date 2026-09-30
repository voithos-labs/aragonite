/**
 * The editor's open menus: whether any is showing, which is what `menuChange` reports, and one
 * call that closes them all. Every menu attaches `track(close)` to its root element, so it reads
 * open for exactly as long as it is mounted, whichever way it closes.
 */

import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';
import { devWarn } from '../../dev-warn';

/** Why `closeAll` is closing the menus. A swap runs once the new document is in place, so a
 *  menu holding a draft must drop it then; a mode change can still save it. */
export type MenuCloseCause = 'mode-change' | 'document-swap';

export interface MenuPresence {
	/** A getter, so a reader re-runs when a menu opens or closes. */
	readonly isOpen: boolean;
	/** Attach to a menu's root element with the menu's own close. `edits` marks a menu whose rows
	 *  write, which closes at once if it opens in reading mode. */
	track(close: (cause: MenuCloseCause) => void, opts?: { edits?: boolean }): Attachment;
	/** Close every open menu: a document swap and a mode change call it. */
	closeAll(cause: MenuCloseCause): void;
}

export interface MenuPresenceDeps {
	isReading(): boolean;
}

export const MENU_OPENED_IN_READING = 'menu-opened-in-reading';

export function createMenuPresence(deps: MenuPresenceDeps): MenuPresence {
	// A count beside the set, so two menus overlapping still read as one open.
	let count = $state(0);
	const closers = new Set<{ close: (cause: MenuCloseCause) => void }>();
	return {
		get isOpen() {
			return count > 0;
		},
		track(close, opts) {
			return () => {
				const entry = { close };
				// Untracked, or the attachment would depend on the count it writes and rerun forever.
				untrack(() => {
					closers.add(entry);
					count++;
					if (opts?.edits && deps.isReading()) {
						devWarn(MENU_OPENED_IN_READING, 'a menu whose rows write opened in reading mode');
						// The mode is what rules the menu out, as when one changes under it.
						close('mode-change');
					}
				});
				return () =>
					untrack(() => {
						closers.delete(entry);
						count--;
					});
			};
		},
		closeAll(cause) {
			untrack(() => {
				for (const entry of [...closers]) entry.close(cause);
			});
		}
	};
}
