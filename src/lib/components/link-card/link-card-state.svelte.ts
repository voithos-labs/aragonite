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
	/** Anchored beside a live caret; the document keeps focus. The click gesture. */
	open(target: LinkTarget): void;
	/** Opened AND focused, so the trap and Escape's caret restore engage. The chord gesture. */
	enter(target: LinkTarget): void;
	close(): void;
}

export interface LinkCardOptions {
	/** Runs on every entry path before the card takes the screen — the caret snapshot lives here
	 *  rather than at each caller, so entry path N+1 cannot forget it. */
	onOpen: () => void;
}

export function createLinkCardState(options: LinkCardOptions): LinkCardState {
	let target = $state<LinkTarget | null>(null);
	let focusEpoch = $state(0);
	let entries = 0;

	function seat(next: LinkTarget): void {
		target = { path: [...next.path], sourceStart: next.sourceStart };
		options.onOpen();
	}

	return {
		getTarget: () => target,
		getFocusEpoch: () => focusEpoch,
		open: (next) => {
			seat(next);
			focusEpoch = 0;
		},
		enter: (next) => {
			seat(next);
			focusEpoch = ++entries;
		},
		close: () => {
			target = null;
		}
	};
}
