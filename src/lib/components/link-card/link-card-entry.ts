/**
 * `link.openCard` — the keyboard entry to the link card, shared by every kind whose keymap binds
 * it. The chord ENTERS the card (focus in the URL field), unlike a click, which opens it beside a
 * caret that stays the document's.
 */

import type { PresentationMode } from '../../presentation-mode';
import {
	resolveLinkAtPoint,
	type LinkPointQuery,
	type LinkTarget
} from '../blocks/text/link-at-point';
import type { LinkCardState } from './link-card-state.svelte';

export interface LinkCardEntryQuery extends LinkPointQuery {
	card: LinkCardState;
	mode: PresentationMode;
}

/**
 * The construct the chord would enter, or null when there is none: outside live mode every other
 * mode paints the destination already, and a non-collapsed selection is the CREATION gesture,
 * which arrives with its own wave.
 */
function linkCardEntryTarget(query: LinkCardEntryQuery): LinkTarget | null {
	if (query.mode !== 'live') return null;
	if (window.getSelection()?.isCollapsed === false) return null;
	return resolveLinkAtPoint(query)?.target ?? null;
}

/** Enter the card on the construct under the caret, or no-op when the rule above declines. The
 *  chord is consumed either way, by the keymap arm that calls this. */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	const target = linkCardEntryTarget(query);
	if (target) query.card.enter(target);
}
