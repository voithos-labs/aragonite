/**
 * G1.136: a drawn block fills the element the editor made for it, in place under the block's host
 * and never `display: contents`, since rects and the drag handle measure it as the block. A text
 * block's text element sits inside it and holds no element but those the editor painted there: the
 * editor owns its text.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { BLOCK_CONTENT_SELECTOR } from '../caret/block-content-selector';

const violation = (message: string): InvariantViolation => ({ code: 'dom-view-content', message });

/** The mounted drawing: `target` in its place under the block host, and the text element in it
 *  holding nothing but `painted`, what the editor painted there before the drawing ran. */
export function checkDomViewContent(
	target: HTMLElement,
	textEl: HTMLElement | null,
	painted: readonly Element[] = []
): InvariantViolation | null {
	const host = target.parentElement;
	if (host?.querySelector(BLOCK_CONTENT_SELECTOR) !== target) {
		return violation('a drawn block moved the element it was given out of its block');
	}
	if (getComputedStyle(target).display === 'contents') {
		return violation(
			'a drawn block set `display: contents` on the element it was given, which measures as nothing'
		);
	}
	if (!textEl) return null;
	if (!target.contains(textEl)) {
		return violation('a drawing left the text element the editor handed it outside its drawing');
	}
	const foreign = [...textEl.children].find((child) => !painted.includes(child));
	if (foreign) {
		return violation(
			`a drawing put a <${foreign.tagName.toLowerCase()}> inside the text element; the ` +
				'editor owns its text, so put your own elements beside it'
		);
	}
	return null;
}
