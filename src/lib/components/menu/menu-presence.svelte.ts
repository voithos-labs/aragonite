/**
 * How many editor menus are showing, which is what `menuChange` reports. Every menu attaches
 * `track` to its root element, so a menu reads open for exactly as long as it is mounted,
 * whichever way it closes. A count, so two menus overlapping still read as one open.
 */

import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

export interface MenuPresence {
	/** A getter, so a reader re-runs when a menu opens or closes. */
	readonly isOpen: boolean;
	track: Attachment;
}

export function createMenuPresence(): MenuPresence {
	let open = $state(0);
	return {
		get isOpen() {
			return open > 0;
		},
		track() {
			// Untracked, or the attachment would depend on the count it writes and rerun forever.
			untrack(() => open++);
			return () => untrack(() => open--);
		}
	};
}
