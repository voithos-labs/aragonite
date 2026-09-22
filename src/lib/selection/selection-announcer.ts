/**
 * The one place a `selectionChange` event is sent, and the memory of what was last sent.
 * The editor announces its own caret placements as they happen, so the browser's later
 * `selectionchange` has to be able to tell a position subscribers already heard from one
 * only it saw: that is what {@link SelectionAnnouncer.announceIfMoved} is for.
 */

import { selectionsEqual, type EditorSelection } from './primitives';

export interface SelectionAnnouncer {
	/** Send the current selection, whatever was sent last. */
	announce(): void;
	/** Send the current selection only when it differs from the one last sent. */
	announceIfMoved(): void;
}

export function createSelectionAnnouncer(deps: {
	read(): EditorSelection | null;
	emit(selection: EditorSelection | null): void;
}): SelectionAnnouncer {
	// Wrapped rather than held bare, so "nothing announced yet" is distinct from "no selection
	// announced", which a first read of null would otherwise be mistaken for.
	let last: { selection: EditorSelection | null } | null = null;

	function send(selection: EditorSelection | null): void {
		last = { selection };
		deps.emit(selection);
	}

	return {
		announce: () => send(deps.read()),
		announceIfMoved() {
			const selection = deps.read();
			if (last && selectionsEqual(selection, last.selection)) return;
			send(selection);
		}
	};
}
