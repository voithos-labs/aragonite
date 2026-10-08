// Helpers for the blocks whose DOM text is their raw: a code block and a plugin leaf.

import { createCaretAnchor } from '../../caret/widget-offset';

/** Chromium with `white-space: pre` paints no caret on the line after a trailing `\n` unless
 *  something follows; a `<br>` anchors it without touching `textContent`. */
export function anchorTrailingNewline(el: HTMLElement): void {
	if (!el.textContent?.endsWith('\n')) return;
	el.appendChild(createCaretAnchor());
}

/** The DOM text of a block whose text is its raw. */
export function plainTextOf(el: HTMLElement | null | undefined): string {
	return el?.textContent ?? '';
}
