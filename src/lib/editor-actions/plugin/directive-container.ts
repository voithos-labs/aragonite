/**
 * `rebuildRaw` for a `:::` container: writes its first child, the opener line the grammar gives it,
 * back as it stands, then the body and the closing line.
 */

import { rebuildDirectiveContainerRaw } from '../../core/directive/kinds';
import type { CstNode } from '../../core/nodes';

export function createDirectiveRebuild(): (node: CstNode) => void {
	return rebuildDirectiveContainerRaw;
}
