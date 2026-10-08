/** The `<br>` an editable with no content holds so it keeps a line, alone or after non-editable
 *  marker chrome (a list item's `- `); a caret goes before it, since Chromium drops a composition
 *  started after it (`docs/design/caret-placement.md`). */
export function placeholderBreakOf(container: ParentNode): HTMLBRElement | null {
	const children = Array.from(container.childNodes).filter(
		(child) => child.nodeType !== Node.TEXT_NODE || (child.textContent ?? '') !== ''
	);
	const last = children.pop();
	if (!(last instanceof HTMLBRElement)) return null;
	const chromeOnly = children.every(
		(child) => child instanceof HTMLElement && child.getAttribute('contenteditable') === 'false'
	);
	return chromeOnly ? last : null;
}
