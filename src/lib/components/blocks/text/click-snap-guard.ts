/** True when the caret sits in a real text node — a valid in-text caret
 * the synthetic indicator shouldn't fight (native caret renders). */
export function caretIsInTextContent(el: HTMLElement, sel: Selection | null): boolean {
	if (!sel || sel.rangeCount === 0) return false;
	const range = sel.getRangeAt(0);
	return range.startContainer.nodeType === Node.TEXT_NODE && el.contains(range.startContainer);
}
