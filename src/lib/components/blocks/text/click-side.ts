/**
 * What a click means at a hidden edge, read from where the press landed against the text: in the
 * blank space past the end of its line, a fresh start, so the next letter types plain. Asked once,
 * from the click entry both prose blocks share (`widget-interaction.ts :: snapClickToWidgetEdge`).
 */

/** `fresh` for a press past the last character on its visual line, else null, where the character
 *  before the caret decides. A press that travelled is a drag, which sets nothing. */
export function clickSide(el: HTMLElement, x: number, y: number, moved: boolean): 'fresh' | null {
	if (moved) return null;
	const end = lineEndX(el, y);
	return end !== null && x > end ? 'fresh' : null;
}

/** The right edge of the text on the visual line at `y`, or null where nothing is drawn on it. */
function lineEndX(el: HTMLElement, y: number): number | null {
	const range = document.createRange();
	range.selectNodeContents(el);
	let end: number | null = null;
	for (const rect of range.getClientRects()) {
		if (rect.width === 0 || y < rect.top || y > rect.bottom) continue;
		end = end === null ? rect.right : Math.max(end, rect.right);
	}
	return end;
}
