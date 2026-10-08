/**
 * G1.75: a selection endpoint the editor writes never sits after an empty block's placeholder
 * `<br>`. Chromium drops a composition started there after its first update and never sends
 * `compositionend`, so the composed text is lost or doubled.
 */

import type { InvariantViolation } from '../assert';
import { placeholderBreakOf } from '../caret/placeholder-break';

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
		message: `a selection endpoint was written at offset ${position.offset}, after an empty block's placeholder <br>: write it before the <br>`
	};
}
