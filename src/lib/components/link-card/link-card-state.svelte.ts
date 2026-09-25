// The open link card's target: only what identifies it, a path plus where the construct starts,
// because every commit rebuilds the inline tree and a captured node would point at moved bytes.

import type { LinkTarget } from '../blocks/text/link-at-point';

/** The create gesture's target: the raw range a commit would wrap. A range, not a construct,
 *  since the document holds nothing until Enter writes it, so Escape has nothing to clean up. */
export interface CreateLinkTarget {
	path: number[];
	start: number;
	end: number;
}

export interface LinkCardState {
	getTarget(): LinkTarget | null;
	/** Set and `getTarget()` are mutually exclusive: one card, one target. */
	getCreateTarget(): CreateLinkTarget | null;
	/** Zero for a click, a fresh number for each keyboard entry; the card focuses its field when
	 *  it changes, which also covers `Mod+K` on a card already open. */
	getFocusEpoch(): number;
	/** Positioned beside a live caret; the document keeps focus. The click gesture.
	 *  False when `canOpen` refused and no card opened. */
	open(target: LinkTarget): boolean;
	/** Opened and focused, so the focus trap and Escape's caret restore both apply. The chord
	 *  gesture. False when `canEnter` refused. */
	enter(target: LinkTarget): boolean;
	/** Entered over the range a commit would wrap. False when `canOpenCreate` refused. */
	enterCreate(target: CreateLinkTarget): boolean;
	close(): void;
}

export interface LinkCardOptions {
	/** Runs on every entry path before the card takes the screen: the caret snapshot lives here
	 *  rather than at each caller, so the next entry path cannot forget it. */
	onOpen: () => void;
	/** For a click: a live selection, native or the editor's cross-block range, is a gesture an
	 *  unasked-for card must not interrupt or write over. */
	canOpen: () => boolean;
	/** For the chord, looser than the click's by exactly one case: the entry resolves the
	 *  construct from the selection itself, so a range it allows is the card's own bytes. */
	canEnter: () => boolean;
	/** For create: requires the very selection `canOpen` forbids, since the range is the
	 *  gesture's target. Separate and required so each entry states which gesture it is;
	 *  a cross-block range is refused by all three. */
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
