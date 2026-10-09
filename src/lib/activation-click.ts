/**
 * Whether a click follows what it lands on (a link, a footnote jump, a widget that goes somewhere)
 * instead of editing it. Every route that follows a click asks the one rule here, bound per editor
 * to its mode and the host's `linkClick` prop, so none reads Ctrl or Cmd by hand.
 */

import { hidesDelimitersAtCaret, type PresentationMode } from './presentation-mode';

/** Which click follows a link while editing: Ctrl/Cmd-click, or any click. */
export type LinkClick = 'modifier' | 'plain';

/** What the rule reads off a click; a `MouseEvent` is one. Without `detail` and `target` it reads
 *  as one click with nothing selected, which is how the cursor asks where a plain click follows. */
export type ClickInput = Pick<MouseEvent, 'ctrlKey' | 'metaKey'> &
	Partial<Pick<MouseEvent, 'detail' | 'target'>>;

/** One editor's answer for a click on something that goes somewhere. */
export type ActivationClick = (click: ClickInput) => boolean;

export function isModifiedClick(click: ClickInput): boolean {
	return click.ctrlKey || click.metaKey;
}

export function followsClick(
	modified: boolean,
	mode: PresentationMode,
	linkClick: LinkClick
): boolean {
	// Reading mode has no caret for a click to place.
	if (modified || mode === 'reading') return true;
	// A plain click edits wherever the caret's block shows syntax to edit.
	return linkClick === 'plain' && hidesDelimitersAtCaret(mode);
}

/** Reads the mode and the gesture at each click. Only a single click follows, never a double-click's
 *  later press or a drag's release, which `endsHoldingRange` tells from a real click's target. */
export function bindActivationClick(
	mode: () => PresentationMode,
	linkClick: () => LinkClick,
	endsHoldingRange: (target: EventTarget) => boolean
): ActivationClick {
	return (click) => {
		if ((click.detail ?? 1) > 1) return false;
		if (click.target && endsHoldingRange(click.target)) return false;
		return followsClick(isModifiedClick(click), mode(), linkClick());
	};
}
