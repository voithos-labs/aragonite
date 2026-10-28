/**
 * G1.159: a caret the writer is asked for at a spot nothing shows (every neighbour a hidden marker
 * run) and no visible text holds the same offset is refused. G1.33 asks the same of a block at
 * focus, for a caret no writer placed.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { caretSpotOf } from '../browser/caret-spot';

export function checkCaretPaints(
	el: HTMLElement,
	at: { node: Node; offset: number }
): InvariantViolation | null {
	if (caretSpotOf(el, at) !== 'none') return null;
	return {
		code: 'caret-paints',
		message:
			'the caret writer was asked for a caret where every neighbour is a hidden marker run, so nothing would show it and the write was refused: paint the chrome while it stands over no content',
		detail: { node: at.node.nodeName, offset: at.offset }
	};
}
