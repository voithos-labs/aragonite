/**
 * The class of block with no character positions inside it: `blockFocus: 'whole-block'` means the
 * block is focused and deleted as one unit, and having no children means there is no editable area
 * inside it either, so what it draws (an SVG, a toolbar) is frame rather than the block's bytes.
 * Its only offsets are 0 and `displayLength(raw)`; `selection/char-endpoint-snap.ts` holds
 * selection to them.
 */

import type { NodeView } from '../core/node-views';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

export function isWholeBlockUnit(node: NodeView): boolean {
	if ((node.children?.length ?? 0) !== 0) return false;
	return tryGetBlockKindDescriptor(node.kind)?.blockFocus === 'whole-block';
}
