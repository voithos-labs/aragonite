/**
 * Whether a click follows what it lands on (a link, a footnote jump, a widget that goes somewhere)
 * instead of editing it. Every route that follows a click asks the one rule here, bound per editor
 * to its mode and the host's `linkClick` prop, so none reads Ctrl or Cmd by hand.
 */

import { hidesDelimitersAtCaret, type PresentationMode } from './presentation-mode';

export const LINK_CLICKS = ['modifier', 'plain'] as const;
/** Which click follows a link while editing: Ctrl/Cmd-click, or any click. */
export type LinkClick = (typeof LINK_CLICKS)[number];

/** The keys of a click the rule reads; a `MouseEvent` is one. */
export type ClickModifiers = Pick<MouseEvent, 'ctrlKey' | 'metaKey'>;

/** One editor's answer for a click on something that goes somewhere. */
export type ActivationClick = (click: ClickModifiers) => boolean;

export function isModifiedClick(click: ClickModifiers): boolean {
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

/** Reads the mode and the gesture at each click, so the answer follows a switch of either. */
export function bindActivationClick(
	mode: () => PresentationMode,
	linkClick: () => LinkClick
): ActivationClick {
	return (click) => followsClick(isModifiedClick(click), mode(), linkClick());
}
