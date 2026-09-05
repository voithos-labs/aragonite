// The open link card's target. Identity only — path plus construct start — because every commit
// rebuilds the inline tree, so a captured node would address bytes that moved.

import type { LinkTarget } from '../blocks/text/link-at-point';

/** The create gesture's target: the raw range a commit would wrap. A range, not a construct —
 *  the document holds nothing until Enter mints it, which is what lets Escape owe no cleanup. */
export interface CreateLinkTarget {
	path: number[];
	start: number;
	end: number;
}

export interface LinkCardState {
	getTarget(): LinkTarget | null;
	/** Set and `getTarget()` are mutually exclusive: one card, one target. */
	getCreateTarget(): CreateLinkTarget | null;
	/**
	 * Zero for a click, a fresh positive number for each keyboard entry. The card focuses its field
	 * when this differs from the zero it starts at, which separates the two gestures without a mode
	 * flag AND survives the case with no remount to key on: `Mod+K` on an already-open card.
	 */
	getFocusEpoch(): number;
	/** Anchored beside a live caret; the document keeps focus. The click gesture.
	 *  False when `canOpen` declined and no card opened. */
	open(target: LinkTarget): boolean;
	/** Opened AND focused, so the trap and Escape's caret restore engage. The chord gesture.
	 *  False when `canEnter` declined. */
	enter(target: LinkTarget): boolean;
	/** Entered over the range a commit would wrap. False when `canOpenCreate` declined. */
	enterCreate(target: CreateLinkTarget): boolean;
	close(): void;
}

export interface LinkCardOptions {
	/** Runs on every entry path before the card takes the screen — the caret snapshot lives here
	 *  rather than at each caller, so entry path N+1 cannot forget it. */
	onOpen: () => void;
	/** The CLICK door: a live selection — native or the editor's cross-block range — is a gesture
	 *  an unasked-for card must not interrupt or write over. */
	canOpen: () => boolean;
	/** The CHORD door, looser than the click's by exactly one case: the entry resolves the
	 *  construct from the selection itself, so a range it admits is the card's own bytes. */
	canEnter: () => boolean;
	/** The create door: gates on the very selection `canOpen` forbids, since the range IS the
	 *  gesture's target. Separate and required so each entry states which gesture it carries;
	 *  a cross-block range declines at all three. */
	canOpenCreate: () => boolean;
}

export function createLinkCardState(options: LinkCardOptions): LinkCardState {
	let target = $state<LinkTarget | null>(null);
	let createTarget = $state<CreateLinkTarget | null>(null);
	let focusEpoch = $state(0);
	let entries = 0;

	function seat(next: LinkTarget, admits: () => boolean): boolean {
		if (!admits()) return false;
		createTarget = null;
		target = { path: [...next.path], sourceStart: next.sourceStart };
		options.onOpen();
		return true;
	}

	return {
		getTarget: () => target,
		getCreateTarget: () => createTarget,
		getFocusEpoch: () => focusEpoch,
		open: (next) => {
			if (!seat(next, options.canOpen)) return false;
			focusEpoch = 0;
			return true;
		},
		enter: (next) => {
			if (!seat(next, options.canEnter)) return false;
			focusEpoch = ++entries;
			return true;
		},
		enterCreate: (next) => {
			if (!options.canOpenCreate()) return false;
			target = null;
			createTarget = { path: [...next.path], start: next.start, end: next.end };
			options.onOpen();
			focusEpoch = ++entries;
			return true;
		},
		close: () => {
			target = null;
			createTarget = null;
		}
	};
}
