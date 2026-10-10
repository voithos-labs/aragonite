/**
 * What a click means at a hidden edge, read from where the press landed against the text: in the
 * blank space past the end of its line, a fresh start, so the next letter types plain; beside a code
 * chip, the side of its border it hit. Asked once, from the click entry both prose blocks share
 * (`widget-interaction.ts :: snapClickToWidgetEdge`).
 */

import { lineEndNearest } from '../../../caret/visual-lines';
import { CODE_CHIP } from '../../../caret/drawn-caret-measure';

export type ClickSide = 'fresh' | 'chip-inside' | 'chip-outside' | null;

/** `fresh` past the last character on the visual line nearest the press, a chip's side for a press
 *  beside one, else null. A press that travelled is a drag, which sets nothing. */
export function clickSide(el: HTMLElement, x: number, y: number, moved: boolean): ClickSide {
	if (moved) return null;
	const end = lineEndNearest(el, y);
	if (end !== null && x > end) return 'fresh';
	return chipSide(el, x, y);
}

// ── Internal ────────────────────────────────────────────────────────────────

/** How far past a chip's border a press still counts as beside it. */
const REACH = 8;

/** Past the border of a chip on the press's line is outside, inside its box is inside; null away
 *  from every chip. Either only counts where the caret landed at that chip's edge. */
function chipSide(el: HTMLElement, x: number, y: number): ClickSide {
	for (const chip of el.querySelectorAll<HTMLElement>(CODE_CHIP)) {
		const box = [...chip.getClientRects()].find((r) => y >= r.top && y <= r.bottom);
		if (!box || x < box.left - REACH || x > box.right + REACH) continue;
		return x < box.left || x > box.right ? 'chip-outside' : 'chip-inside';
	}
	return null;
}
