/**
 * Carry a focused caret across an imperative DOM rebuild. A decoration-driven rebuild
 * mints fresh spans with no edit-path pending offset, so the render path captures the
 * caret in walk space before the rebuild and restores it after — through the single-home
 * offset walk (`widget-offset.ts`), shared by the prose and table-cell render paths.
 */

import type { DomTextOffset } from './coordinate-spaces';
import { createRangeAtDomTextOffsets, domTextOffsetAtNode } from './widget-offset';

/** The live caret as a walk-space offset, or null when `el` does not own focus. */
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
