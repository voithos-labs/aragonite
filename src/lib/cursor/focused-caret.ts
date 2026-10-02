/**
 * Keep a focused caret across an imperative DOM rebuild: a decoration-driven rebuild creates
 * fresh spans with no pending offset from an edit, so the render path reads the caret as a raw
 * offset before the rebuild and writes it back after (`placeCaretAtRaw`, exact).
 */

import type { RawOffset } from './coordinate-spaces';
import { rawOffsetAt } from './widget-offset';

/** The live caret as a raw offset, or null when `el` does not own focus. */
export function captureFocusedCaret(el: HTMLElement): RawOffset | null {
	if (!document.activeElement || !el.contains(document.activeElement)) return null;
	const sel = window.getSelection();
	if (!sel?.focusNode || !el.contains(sel.focusNode)) return null;
	return rawOffsetAt(el, sel.focusNode, sel.focusOffset);
}
