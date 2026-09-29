/**
 * G1.46: a caret or range the editor puts down leaves no widget selected whole. Taking the caret
 * ends the widget through the selection state's clears; a clear that skipped it would leave the
 * image looking selected while the keys go to the caret.
 */

import type { InvariantViolation } from '../assert';
import type { WidgetTarget } from '../selection/primitives';

export function checkPlacementEndsWidget(widget: WidgetTarget | null): InvariantViolation | null {
	if (widget === null) return null;
	return {
		code: 'placement-ends-widget',
		message: `a caret or range was put down while the widget at ${JSON.stringify(widget.paragraphPath)}:${widget.sourceStart} stayed selected: end it through the selection state's clear`
	};
}
