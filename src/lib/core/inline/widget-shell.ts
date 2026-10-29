/** The span every inline widget is drawn in, and the source range it carries. */

import type { InlineNode } from '../nodes';

/**
 * The shell every inline widget is drawn in. Its `data-*` attributes are the only handle the
 * DOM-to-offset traversal has, so the shell is created here once and builders add only the body.
 */
export function mintWidgetShell(node: InlineNode, className?: string): HTMLSpanElement {
	const shell = document.createElement('span');
	if (className) shell.className = className;
	shell.dataset.inlineWidget = '';
	shell.dataset.sourceStart = String(node.start);
	shell.dataset.sourceEnd = String(node.end);
	shell.setAttribute('contenteditable', 'false');
	return shell;
}

/** Marks a widget whose kind declares `frame`, so the caret beside it draws at its line's text
 *  height. Stamped at render, since layout can't be read there. */
export const FRAME_ATTR = 'data-widget-frame';

/** The raw byte range a shell carries, or null when the attributes are absent or malformed:
 *  {@link mintWidgetShell}'s inverse, kept beside it so the two move together. */
export function widgetSourceRange(el: Element): { start: number; end: number } | null {
	const start = parseInt(el.getAttribute('data-source-start') ?? '', 10);
	const end = parseInt(el.getAttribute('data-source-end') ?? '', 10);
	if (Number.isNaN(start) || Number.isNaN(end)) return null;
	return { start, end };
}
