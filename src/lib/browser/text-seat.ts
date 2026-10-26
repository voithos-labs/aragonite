/**
 * Where a caret position sits against what the user sees: in visible text, or somewhere a click
 * moves it away from (beside a widget, in hidden marker text, inside a container's marker prefix).
 */

import { isHiddenMarkerText, isInsideAtomicWidget } from './painted';
import { isInMarkerPrefix } from './offsets';
import { readNativeSelection } from './selection-read';

/** Whether the live caret sits in a text node the user can see, where the browser draws a caret,
 *  so the editor's own indicator is not needed. Hidden marker text renders nothing. */
export function caretIsInTextContent(el: HTMLElement): boolean {
	const live = readNativeSelection();
	return !!live && seatIsInTextContent(el, live.range.startContainer);
}

/** The same read for a caret position given as a node: the one a press is about to make. A
 *  widget's own text paints, but takes no typing. */
function seatIsInTextContent(el: HTMLElement, node: Node): boolean {
	if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
	return !isHiddenMarkerText(node, el) && !isInsideAtomicWidget(el, node);
}

/** Whether the click ending a press that put the caret at `seat` moves it: off a widget's side to
 *  its edge, or out of the marker prefix to the text's start. */
export function clickMovesSeat(el: HTMLElement, seat: { node: Node; offset: number }): boolean {
	return !seatIsInTextContent(el, seat.node) || isInMarkerPrefix(el, seat.node, seat.offset);
}
