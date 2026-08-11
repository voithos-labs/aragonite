/**
 * Whether a block keeps structure PAST its content that the surface paints nothing for — today the
 * setext underline. A merge past it concatenates it into view (`Title\n===` + `next` reparses to a
 * paragraph showing `===next`), so the keydown dispatch consumes the press and the command arm
 * declines it — one home, since the two ask from different coordinate sources (live-mode.md § 4.5).
 */

import { getContentRange } from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import { revealsNoMarkers } from '../../../cursor/widget-offset';

/** `displayLength` is the caller's, not this module's: the component reads the DOM while a widget
 *  reveal is open, where `node.raw` is stale by construction. */
export function hidesStructuralSuffix(
	el: HTMLElement | null,
	node: NodeView,
	displayLength: number
): boolean {
	if (!el || !revealsNoMarkers(el)) return false;
	return getContentRange(node).end < displayLength;
}
