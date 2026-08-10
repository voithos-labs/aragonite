/**
 * `link.openCard` — the keyboard entry to the link card, shared by every kind whose keymap binds
 * it. The chord ENTERS the card (focus in the URL field), unlike a click, which opens it beside a
 * caret that stays the document's. Live mode only: every other mode paints the destination.
 */

import type { PresentationMode } from '../../presentation-mode';
import { canWrapRangeAsLink } from '../blocks/text/link-source-bytes';
import { resolveLinkAtPoint, type LinkPointQuery } from '../blocks/text/link-at-point';
import type { LinkCardState } from './link-card-state.svelte';

export interface LinkCardEntryQuery extends LinkPointQuery {
	card: LinkCardState;
	mode: PresentationMode;
	/** The block-local raw selection, or null at a collapsed caret. Required, never defaulted:
	 *  every keymap arm states its create policy, so a surface that must not mint links says so. */
	selection: { start: number; end: number } | null;
}

/**
 * Enter the card for the chord: over a selection, CREATE mode on the range — declined when it
 * crosses another construct's bytes, since wrapping inside or across one is a policy question;
 * at a collapsed caret, the construct under it or nothing. The chord is consumed either way,
 * by the keymap arm that calls this.
 */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	if (query.mode !== 'live') return;
	const range = query.selection;
	if (range !== null && range.start < range.end) {
		if (canWrapRangeAsLink(query.block.raw, range.start, range.end, query.linkRef?.current))
			query.card.enterCreate({ path: query.path, start: range.start, end: range.end });
		return;
	}
	const target = resolveLinkAtPoint(query)?.target ?? null;
	if (target) query.card.enter(target);
}
