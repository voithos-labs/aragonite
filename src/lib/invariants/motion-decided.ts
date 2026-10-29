/**
 * G1.163: a caret key the editor decided leaves the selection it wrote. A different live selection
 * at the next `selectionchange` or keydown means the browser's own move ran as well.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

interface Position {
	node: Node;
	offset: number;
}

export function checkMotionDecided(
	wrote: { anchor: Position; focus: Position },
	live: Selection | null
): InvariantViolation | null {
	const at = (node: Node | null | undefined, offset: number | undefined, want: Position) =>
		node === want.node && offset === want.offset;
	if (live && at(live.anchorNode, live.anchorOffset, wrote.anchor)) {
		if (at(live.focusNode, live.focusOffset, wrote.focus)) return null;
	}
	return {
		code: 'caret-motion-decided',
		message: `a caret key the editor placed at ${wrote.focus.node.nodeName} @ ${wrote.focus.offset} left the focus at ${live?.focusNode?.nodeName ?? 'nothing'} @ ${live?.focusOffset ?? '-'}: the browser's own move ran after the editor's, so the key's default wasn't prevented`
	};
}
