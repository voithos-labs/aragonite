/**
 * What a click means at a hidden edge, read from where the press landed against the text: in the
 * blank space past the end of its line, a fresh start, so the next letter types plain. Asked once,
 * from the click entry both prose blocks share (`widget-interaction.ts :: snapClickToWidgetEdge`).
 */

import { lineEndNearest } from '../../../caret/visual-lines';

/** `fresh` for a press past the last character on the visual line nearest it, else null, where
 *  the character before the caret decides. A press that travelled is a drag, which sets nothing. */
export function clickSide(el: HTMLElement, x: number, y: number, moved: boolean): 'fresh' | null {
	if (moved) return null;
	const end = lineEndNearest(el, y);
	return end !== null && x > end ? 'fresh' : null;
}
