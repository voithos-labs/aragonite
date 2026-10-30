/**
 * Scrolls a caret the editor wrote into view, as the browser does for a caret its own key moved:
 * every box around the block that scrolls sideways (a long code line, a wide table), then the page.
 */

import { caretRectAt, neighbourCaretRect } from '../browser/visual-lines';
import { readNativeSelection } from '../browser/selection-read';
import type { ScrollOwner } from '../windowing/scroll-owner';

/** Shows the live selection's focus in `el`; a focus outside `el` is left alone. */
export function showCaret(el: HTMLElement, scroll: Pick<ScrollOwner, 'showRect'>): void {
	const focus = readNativeSelection()?.focus;
	if (!focus || !el.contains(focus.node)) return;
	const read = () =>
		caretRectAt(el, focus.node, focus.offset) ??
		neighbourCaretRect({ startContainer: focus.node, startOffset: focus.offset });
	for (let box: Element | null = el; box && box !== document.body; box = box.parentElement) {
		if (box.scrollWidth <= box.clientWidth || !SIDEWAYS.has(getComputedStyle(box).overflowX)) {
			continue;
		}
		// Read per box, since scrolling an inner one moves the caret against the outer ones.
		const caret = read();
		if (!caret) return;
		const left = box.getBoundingClientRect().left + box.clientLeft;
		const right = left + box.clientWidth;
		if (caret.left > right) box.scrollLeft += caret.left - right + 1;
		else if (caret.left < left) box.scrollLeft -= left - caret.left;
	}
	scroll.showRect(() => {
		const rect = read();
		return rect && new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top);
	});
}

const SIDEWAYS = new Set(['auto', 'scroll']);
