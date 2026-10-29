/**
 * G1.160: a widget beside a caret the writer puts down lays out inline. One laid out as a block
 * has no line beside it, so a letter typed there lands on another line, Chromium starts no
 * composition there, and nothing draws the caret. A plugin's widget sets its own `display`.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { widgetsBeside } from '../browser/caret-spot';

export function checkWidgetLaysOutInline(
	el: HTMLElement,
	at: { node: Node; offset: number }
): InvariantViolation | null {
	for (const widget of widgetsBeside(el, at)) {
		const display = getComputedStyle(widget).display;
		if (display === 'contents' || display === 'none' || display.startsWith('inline')) continue;
		return {
			code: 'widget-lays-out-inline',
			message: `a caret was written beside a widget laid out as \`display: ${display}\`, where it has no line: lay the widget out inline (\`inline-block\` for a box), and declare \`frame\` on a box taller than its text`,
			detail: { display, widget: widget.className }
		};
	}
	return null;
}
