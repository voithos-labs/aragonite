/**
 * Keep a focused caret across an imperative DOM rebuild. A decoration-driven rebuild creates
 * fresh spans with no pending offset from an edit, so the render path captures the caret as a
 * DOM-walk offset before the rebuild and restores it after, through the one offset walk
 * (`widget-offset.ts`); the prose and table-cell render paths share this.
 */

import type { DomTextOffset } from './coordinate-spaces';
import { createRangeAtDomTextOffsets, domTextOffsetAtNode } from './widget-offset';

/** The live caret as a DOM-walk offset, or null when `el` does not own focus. */
export function captureFocusedCaretWalkOffset(el: HTMLElement): DomTextOffset | null {
	if (!document.activeElement || !el.contains(document.activeElement)) return null;
	const sel = window.getSelection();
	if (!sel?.focusNode || !el.contains(sel.focusNode)) return null;
	return domTextOffsetAtNode(el, sel.focusNode, sel.focusOffset);
}

export function restoreCaretAtWalkOffset(el: HTMLElement, walkOffset: DomTextOffset): void {
	const range = createRangeAtDomTextOffsets(el, walkOffset, walkOffset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}
