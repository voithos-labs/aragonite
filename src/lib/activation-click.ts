/**
 * Whether a click follows what it lands on (a link, a footnote jump, a widget that goes somewhere)
 * instead of editing it. Every route that follows a click asks the one rule here, bound per editor
 * to its mode and the host's `linkClick` prop, so none reads Ctrl or Cmd by hand.
 */

import { hidesDelimitersAtCaret, type PresentationMode } from './presentation-mode';

/** Which click follows a link while editing: Ctrl/Cmd-click, or any click. */
export type LinkClick = 'modifier' | 'plain';

/** What the rule reads off a click; a `MouseEvent` is one. Without `detail` it reads as one click
 *  that didn't travel, which is how the cursor asks where a plain click follows. */
export type ClickInput = Pick<MouseEvent, 'ctrlKey' | 'metaKey'> &
	Partial<Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>>;

/** One editor's answer for a click on something that goes somewhere. */
export type ActivationClick = (click: ClickInput) => boolean;

/** Where the editor's last press went down, so a click can tell it ended a drag. */
export interface PressTracker {
	press(at: { clientX: number; clientY: number }): void;
	/** Whether the pointer travelled past the drag threshold between that press and `at`. */
	travelled(at: { clientX: number; clientY: number }): boolean;
}

/** The pointer distance, in CSS pixels, past which a press and its release are a drag. */
export const DRAG_SLOP_PX = 3;

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

export function createPressTracker(): PressTracker {
	let last: { x: number; y: number } | null = null;
	return {
		press: ({ clientX, clientY }) => {
			last = { x: clientX, y: clientY };
		},
		travelled: ({ clientX, clientY }) =>
			last !== null &&
			(Math.abs(clientX - last.x) > DRAG_SLOP_PX || Math.abs(clientY - last.y) > DRAG_SLOP_PX)
	};
}

/** Reads the mode and the gesture at each click. Only a single pointer click that didn't travel
 *  follows; a keyboard click (`detail` 0) has no press to travel from. */
export function bindActivationClick(
	mode: () => PresentationMode,
	linkClick: () => LinkClick,
	presses: Pick<PressTracker, 'travelled'>
): ActivationClick {
	return (click) => {
		const detail = click.detail ?? 0;
		if (detail > 1) return false;
		const { clientX, clientY } = click;
		if (detail === 1 && clientX !== undefined && clientY !== undefined) {
			if (presses.travelled({ clientX, clientY })) return false;
		}
		return followsClick(isModifiedClick(click), mode(), linkClick());
	};
}
