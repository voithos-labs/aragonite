/**
 * `link.openCard`: the keyboard way into the link card, and the pressed state a toolbar paints
 * for it, both from one lookup of the construct holding the caret or a range inside it. The chord
 * enters the card, with focus in the URL field, unlike a click, which opens it beside a caret that
 * stays in the document. Live mode only: every other mode paints the destination.
 */

import { canWrapRangeAsLink } from '../blocks/text/link-source-bytes';
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
	/** True while a range crosses block boundaries. Required for the same reason, and because
	 *  `selection` cannot report it: measured against this block's own DOM, an endpoint in another
	 *  block comes back as the end of this one, a range to the block's end that nobody made. */
	crossBlockRange: boolean;
}

export interface LinkCardEntryQuery extends LinkCardTargetQuery {
	card: LinkCardState;
}

/**
 * The construct the chord would edit: the card-editable one under the caret, which a range must
 * lie wholly inside since the card edits one link. Null where the chord creates instead or opens
 * nothing, so the pressed state and the click it promises resolve the same construct.
 */
export function linkCardTargetAt(query: LinkCardTargetQuery): LinkTarget | null {
	if (query.reading.mode() !== 'live' || query.crossBlockRange) return null;
	const hit = resolveLinkAtPoint(query);
	if (hit === null) return null;
	const range = query.selection;
	if (range && (range.start < hit.link.start || range.end > hit.link.end)) return null;
	return hit.target;
}

/**
 * Enter the card for the chord: edit the construct the caret, or a range lying wholly inside it,
 * sits in; failing that, create one over the range, refused when the range crosses another
 * construct's bytes, since wrapping inside or across one has no agreed answer. The chord is
 * taken either way, by the keymap branch that calls this.
 */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	if (query.reading.mode() !== 'live') return;
	// The command dispatch already refuses `link.openCard` over a cross-block range
	// (`RANGE_DECLINED_COMMAND_IDS`); checked again here because the offsets this would
	// otherwise trust are made up in exactly that state rather than missing.
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
