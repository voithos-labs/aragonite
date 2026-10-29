import { isAtomicInlineWidget } from './painted';

/** The `<br>` closing an editable that a caret goes before: the one an editable with no content
 *  holds so it keeps a line (alone or after non-editable marker chrome, a list item's `- `), or the
 *  anchor a picture ending the content leaves. Chromium drops a composition started after an empty
 *  editable's (`docs/design/caret-placement.md`). */
export function placeholderBreakOf(container: ParentNode): HTMLBRElement | null {
	const children = Array.from(container.childNodes).filter(
		(child) => child.nodeType !== Node.TEXT_NODE || (child.textContent ?? '') !== ''
	);
	const last = children.pop();
	if (!(last instanceof HTMLBRElement)) return null;
	if (last.dataset.caretAnchor === 'frame') return last;
	const chromeOnly = children.every(
		(child) =>
			child instanceof HTMLElement &&
			child.getAttribute('contenteditable') === 'false' &&
			!isAtomicInlineWidget(child)
	);
	return chromeOnly ? last : null;
}
