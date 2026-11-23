/**
 * G1.133: in reading mode at most one element in the editor that isn't a control sits in the tab
 * order, the reading-mode stop. A second one means a block set its own tabindex (or left itself
 * editable) instead of taking the stop's, and Tab walks it like a link. The host's header is its own.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

const CONTROL =
	'a[href], button, input, select, textarea, summary, [role="link"], [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';
// What a browser's Tab can reach with no tabindex of its own, beside the controls.
const FOCUSABLE = '[tabindex], [contenteditable]:not([contenteditable="false"]), iframe';

export function checkReadingTabStops(root: HTMLElement | null): InvariantViolation | null {
	if (!root) return null;
	const stops = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) =>
			(!el.hasAttribute('tabindex') || el.tabIndex >= 0) &&
			!el.matches(CONTROL) &&
			!el.closest('[data-host-content]') &&
			// A hidden element takes no focus: a drawn block's text element while its picture shows.
			!el.closest('[hidden]')
	);
	if (stops.length <= 1) return null;
	const named = stops.map((el) => {
		const path = el.closest('[data-block-path]')?.getAttribute('data-block-path') ?? '?';
		return `${el.tagName.toLowerCase()}.${el.classList[0] ?? ''} at ${path}`;
	});
	return {
		code: 'reading-tab-stops',
		message: `reading mode has ${stops.length} tab stops that aren't controls (${named.join(', ')}): a block's focus element takes its tabindex from the reading-mode stop`
	};
}
