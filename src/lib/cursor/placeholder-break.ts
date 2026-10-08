/** The `<br>` an editable with no content holds so it keeps a line; a caret goes before it, since
 *  Chromium drops a composition started after it (`docs/design/caret-placement.md`). */
export function placeholderBreakOf(container: ParentNode): HTMLBRElement | null {
	let found: HTMLBRElement | null = null;
	for (const child of Array.from(container.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '') === '') continue;
		if (found || !(child instanceof HTMLBRElement)) return null;
		found = child;
	}
	return found;
}
