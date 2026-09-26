// Helpers for the surfaces whose DOM text is their raw: a code block and a plugin leaf.

/**
 * Chromium with `white-space: pre` won't paint a caret on the line after a trailing
 * `\n` unless something follows it. A `<br>` anchors it without touching `textContent`
 * (BR has empty textContent, so `textContent === trimTrailingLineEnding(raw)` holds).
 */
export function anchorTrailingNewline(el: HTMLElement): void {
	if (!el.textContent?.endsWith('\n')) return;
	const anchor = document.createElement('br');
	anchor.dataset.caretAnchor = '';
	el.appendChild(anchor);
}

/** The DOM text of a surface whose text is its raw (a code block, a plugin leaf). */
export function plainTextOf(el: HTMLElement | null | undefined): string {
	return el?.textContent ?? '';
}
