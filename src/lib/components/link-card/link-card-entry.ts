/**
 * `link.openCard` — the keyboard entry to the link card and the pressed state a toolbar paints
 * for it, off one resolution of the construct under the caret. The chord ENTERS the card (focus
 * in the URL field), unlike a click, which opens it beside a caret that stays the document's.
 * Live mode only: every other mode paints the destination.
 */

import type { PresentationMode } from '../../presentation-mode';
import { canWrapRangeAsLink } from '../blocks/text/link-source-bytes';
import {
	resolveLinkAtPoint,
	type LinkPointQuery,
	type LinkTarget
} from '../blocks/text/link-at-point';
import type { LinkCardState } from './link-card-state.svelte';

/** What locating the card's construct takes, whether a press or a pressed-state read asks. */
export interface LinkCardTargetQuery extends LinkPointQuery {
	mode: PresentationMode;
	/** The block-local raw selection, or null at a collapsed caret. Required, never defaulted:
	 *  a surface that must mint no link says so by passing null wherever it could create. */
	selection: { start: number; end: number } | null;
	/** True while a range crosses block boundaries. Required for the same reason, and because
	 *  `selection` cannot report it: read off this block's own DOM walk, an endpoint in another
	 *  block comes back as end-of-walk — a range running to the block's end that nobody made. */
	crossBlockRange: boolean;
}

export interface LinkCardEntryQuery extends LinkCardTargetQuery {
	card: LinkCardState;
}

/**
 * The construct the chord would EDIT: the card-editable one under the caret, which a range must
 * lie wholly inside since the card edits ONE link. Null where the chord creates instead or opens
 * nothing, so a pressed paint and the press it promises resolve the same construct.
 */
export function linkCardTargetAt(query: LinkCardTargetQuery): LinkTarget | null {
	if (query.mode !== 'live' || query.crossBlockRange) return null;
	const hit = resolveLinkAtPoint(query);
	if (hit === null) return null;
	const range = query.selection;
	if (range && (range.start < hit.link.start || range.end > hit.link.end)) return null;
	return hit.target;
}

/**
 * Enter the card for the chord: over a selection, CREATE mode on the range — declined when it
 * crosses another construct's bytes, since wrapping inside or across one is a policy question;
 * at a collapsed caret, the construct under it or nothing. The chord is consumed either way,
 * by the keymap arm that calls this.
 */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	if (query.mode !== 'live') return;
	// The dispatch seam declines `link.openCard` over a cross-block range already
	// (`RANGE_DECLINED_COMMAND_IDS`); the belt is here because the offsets this arm would
	// otherwise trust are fabricated in exactly that state rather than absent.
	if (query.crossBlockRange) return;
	const range = query.selection;
	if (range !== null && range.start < range.end) {
		if (canWrapRangeAsLink(query.block.raw, range.start, range.end, query.linkRef?.current))
			query.card.enterCreate({ path: query.path, start: range.start, end: range.end });
		return;
	}
	const target = linkCardTargetAt(query);
	if (target) query.card.enter(target);
}
