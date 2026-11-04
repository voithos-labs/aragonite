/**
 * `link.openCard`: the keyboard way to edit what the caret would go to, and the pressed state a
 * toolbar paints for it, from one lookup (`followTargetAt`). On a link it enters the card, with
 * focus in the URL field, and on an autolink it puts the caret at the URL's end (both live mode
 * only: every other mode shows their syntax); beside a widget that goes somewhere it shows the
 * widget's source, in any editable mode.
 */

import { canWrapRangeAsLink } from '../../core/inline/link-source-bytes';
import type { InlineNode } from '../../core/nodes';
import {
	followTargetAtCaret,
	type FollowTarget,
	type LinkPointQuery,
	type LinkTarget
} from '../blocks/text/link-at-point';
import type { LinkCardState } from './link-card-state.svelte';

/** What locating the card's construct takes, whether a click or a pressed-state read asks. */
export interface LinkCardTargetQuery extends LinkPointQuery {
	/** The raw selection within this block, or null at a collapsed caret. Required, never given a
	 *  default: a caller that must create no link says so by passing null wherever it could. */
	selection: { start: number; end: number } | null;
	/** True while the editor holds a range across blocks: `selection`, measured against this
	 *  block's DOM, reports an endpoint in another block as this block's end. */
	spansBlocks: boolean;
}

export interface LinkCardEntryQuery extends LinkCardTargetQuery {
	card: LinkCardState;
	/** Shows a widget's source with the caret at the edge it touched. */
	enterWidget(widget: InlineNode, fromTrailingEdge: boolean): void;
	/** Puts the caret at a raw offset in this block, at the end of a construct's own text, which
	 *  the next letter extends even where a hidden closer follows. */
	placeCaretInText(offset: number): void;
}

/** What the chord would edit. */
export type EditTarget =
	{ edit: 'card'; target: LinkTarget } | Extract<FollowTarget, { edit: 'text' | 'source' }>;

/** The construct under the caret or wholly containing the range, or a widget a collapsed caret
 *  touches; null where the chord edits nothing, so the pressed state matches the chord. */
export function editTargetAt(query: LinkCardTargetQuery): EditTarget | null {
	if (query.spansBlocks) return null;
	const hit = followTargetAtCaret(query);
	if (hit === null) return null;
	const range = query.selection;
	if (hit.edit === 'source') return range ? null : hit;
	const construct = hit.edit === 'card' ? hit.link : hit.construct;
	if (range && (range.start < construct.start || range.end > construct.end)) return null;
	if (hit.edit === 'text') return hit;
	return { edit: 'card', target: { path: query.path, sourceStart: hit.link.start } };
}

/** Edits what the caret would go to, else creates a link over the range unless it crosses
 *  another construct's bytes. The keymap takes the chord either way. */
export function enterLinkCardAtCaret(query: LinkCardEntryQuery): void {
	// Command dispatch already refuses a range across blocks; checked again because the offsets
	// here would be made up in that state.
	if (query.spansBlocks) return;
	// Edit before create, since create refuses a range already inside a construct: going the
	// create way there leaves the click doing nothing under a button painted as pressed.
	const target = editTargetAt(query);
	if (target?.edit === 'source') {
		query.enterWidget(target.widget, target.atEnd);
		return;
	}
	if (target?.edit === 'text') {
		query.placeCaretInText(target.caretAt);
		return;
	}
	if (query.reading.mode() !== 'live') return;
	if (target) {
		query.card.enter(target.target);
		return;
	}
	const range = query.selection;
	if (range === null || range.start >= range.end) return;
	if (canWrapRangeAsLink(query.block.raw, range.start, range.end, query.reading))
		query.card.enterCreate({ path: query.path, start: range.start, end: range.end });
}
