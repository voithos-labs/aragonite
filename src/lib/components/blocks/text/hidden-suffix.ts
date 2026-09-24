/**
 * The structure a block keeps after its content, which no mode draws: today the setext underline.
 * A merge past it would join that structure into view (`Title\n===` plus `next` reparses to a
 * paragraph showing `===next`), so the keydown dispatch consumes the key and the command path
 * refuses. Both ask here, from different coordinates (live-mode.md § 4.5).
 */

import { getContentRange } from '../../../core/inline';
import { displayLength } from '../../../core/lines';
import type { NodeView } from '../../../core/node-views';
import { revealsNoMarkers } from '../../../cursor/widget-offset';

/** The bytes between the block's content end and its trailing line ending. The DOM never holds
 *  them, so the text read back from it has to have them put back before it is written. */
export function undrawnSuffix(node: NodeView): string {
	return node.raw.slice(getContentRange(node).end, displayLength(node.raw));
}

/** `displayLength` comes from the caller, not from here: while a widget's source is showing, the
 *  component reads the DOM because `node.raw` is out of date by then. */
export function hidesStructuralSuffix(
	el: HTMLElement | null,
	node: NodeView,
	displayLength: number
): boolean {
	if (!el || !revealsNoMarkers(el)) return false;
	return getContentRange(node).end < displayLength;
}
