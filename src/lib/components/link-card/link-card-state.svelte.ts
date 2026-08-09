// The open link card's target. Identity only — path plus construct start — because every commit
// rebuilds the inline tree, so a captured node would address bytes that moved.

import type { LinkTarget } from '../blocks/text/link-at-point';

export interface LinkCardState {
	getTarget(): LinkTarget | null;
	/**
	 * Zero for a click, a fresh positive number for each keyboard entry. The card focuses its field
	 * when this differs from the zero it starts at, which separates the two gestures without a mode
	 * flag AND survives the case with no remount to key on: `Mod+K` on an already-open card.
	 */
	getFocusEpoch(): number;
	/** Anchored beside a live caret; the document keeps focus. The click gesture.
	 *  False when `canOpen` declined and no card opened. */
	open(target: LinkTarget): boolean;
	/** Opened AND focused, so the trap and Escape's caret restore engage. The chord gesture. */
	enter(target: LinkTarget): boolean;
	close(): void;
}

export interface LinkCardOptions {
	/** Runs on every entry path before the card takes the screen — the caret snapshot lives here
	 *  rather than at each caller, so entry path N+1 cannot forget it. */
	onOpen: () => void;
	/** Gates every entry the same way, for the same reason: a live selection — native or the
	 *  editor's cross-block range — is a gesture the card must not interrupt or write over. */
	canOpen: () => boolean;
}

export function createLinkCardState(options: LinkCardOptions): LinkCardState {
	let target = $state<LinkTarget | null>(null);
	let focusEpoch = $state(0);
	let entries = 0;

	function seat(next: LinkTarget): boolean {
		if (!options.canOpen()) return false;
		target = { path: [...next.path], sourceStart: next.sourceStart };
		options.onOpen();
		return true;
	}

	return {
		getTarget: () => target,
		getFocusEpoch: () => focusEpoch,
		open: (next) => {
			if (!seat(next)) return false;
			focusEpoch = 0;
			return true;
		},
		enter: (next) => {
			if (!seat(next)) return false;
			focusEpoch = ++entries;
			return true;
		},
		close: () => {
			target = null;
		}
	};
}
