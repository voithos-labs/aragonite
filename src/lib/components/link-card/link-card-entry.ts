/**
 * `link.openCard`: the keyboard way into the link card, and the pressed state a toolbar paints
 * for it, both from one lookup of the construct holding the caret or a range inside it. The chord
 * enters the card, with focus in the URL field, unlike a click, which opens it beside a caret that
 * stays in the document. Live mode only: every other mode paints the destination.
 */

import { canWrapRangeAsLink } from '../../core/inline/link-source-bytes';
import {
	resolveLinkAtPoint,
	type LinkPointQuery,
	type LinkTarget
} from '../blocks/text/link-at-point';
import type { LinkCardState } from './link-card-state.svelte';

/** What locating the card's construct takes, whether a click or a pressed-state read asks. */
export interface LinkCardTargetQuery extends LinkPointQuery {
	/** The raw selection within this block, or null at a collapsed caret. Required, never given a
	 *  default: a caller that must create no link says so by passing null wherever it could. */
	selection: { start: number; end: number } | null;
	/** True while a range crosses blocks: `selection`, measured against this block's DOM, reports
	 *  an endpoint in another block as this block's end. */
	crossBlockRange: boolean;
}

export interface LinkCardEntryQuery extends LinkCardTargetQuery {
	card: LinkCardState;
}

/** The construct the chord would edit, under the caret or wholly containing the range; null
 *  where the chord creates or opens nothing, so the pressed state matches the click. */
export function linkCardTargetAt(query: LinkCardTargetQuery): LinkTarget | null {
	if (query.reading.mode() !== 'live' || query.crossBlockRange) return null;
	const hit = resolveLinkAtPoint(query);
	if (hit === null) return null;
	const range = query.selection;
	if (range && (range.start < hit.link.start || range.end > hit.link.end)) return null;
	return hit.target;
}

/** Edits the construct holding the caret or range, else creates one over the range unless it
 *  crosses another construct's bytes. The keymap takes the chord either way. */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	if (query.reading.mode() !== 'live') return;
	// Command dispatch already refuses a cross-block range; checked again because the offsets
	// here would be made up in that state.
	if (query.crossBlockRange) return;
	// Edit before create, since create refuses a range already inside a construct: going the
	// create way there leaves the click doing nothing under a button painted as pressed.
	const target = linkCardTargetAt(query);
	if (target) {
		query.card.enter(target);
		return;
	}
	const range = query.selection;
	if (range === null || range.start >= range.end) return;
	if (canWrapRangeAsLink(query.block.raw, range.start, range.end, query.reading))
		query.card.enterCreate({ path: query.path, start: range.start, end: range.end });
}
