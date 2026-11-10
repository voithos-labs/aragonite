/**
 * G1.208: a widget selected whole in the focused block leaves the browser a collapsed caret in
 * that block. Text that arrives with no key (a soft keyboard, an emoji picker) goes only to a
 * selection, so with none the letter is lost. Reading mode holds no caret and is exempt.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { readNativeSelection } from '../browser/selection-read';

/** `block` is the selected widget's block element, null when it isn't mounted. */
export function checkWidgetKeepsCaret(
	block: HTMLElement | null,
	reading: boolean
): InvariantViolation | null {
	if (!block || reading || document.activeElement !== block) return null;
	const live = readNativeSelection();
	if (live?.collapsed && block.contains(live.focus.node)) return null;
	return {
		code: 'widget-without-caret',
		message:
			'a widget is selected whole in the focused block and the browser holds no collapsed caret there, so text typed with no key has nowhere to arrive: seat it through `seatWidgetCaret`'
	};
}
