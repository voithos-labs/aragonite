/**
 * G1.75: a selection endpoint the editor writes never sits after the `<br>` closing a block (an
 * empty block's placeholder, a picture's line anchor). After a placeholder, Chromium drops a
 * composition after its first update and never sends `compositionend`, losing or doubling it.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { placeholderBreakOf } from '../browser/placeholder-break';

export function checkCaretBeforeBreak(position: {
	node: Node;
	offset: number;
}): InvariantViolation | null {
	const br = placeholderBreakOf(position.node as ParentNode);
	if (!br || position.offset <= Array.prototype.indexOf.call(position.node.childNodes, br)) {
		return null;
	}
	return {
		code: 'caret-before-break',
		message: `a selection endpoint was written at offset ${position.offset}, after the <br> closing its block: write it before the <br>`
	};
}
