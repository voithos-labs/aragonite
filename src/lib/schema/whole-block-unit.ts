/**
 * The kind class with no character positions: `blockFocus: 'whole-block'` declares the opaque
 * focus-then-delete model, and no children means no inner surface either, so the rendered body
 * (an SVG, a toolbar) is chrome rather than the block's bytes. Its only addressable offsets are
 * 0 and `displayLength(raw)`; `selection/char-endpoint-snap.ts` is what holds selection to them.
 */

import type { NodeView } from '../core/node-views';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

export function isWholeBlockUnit(node: NodeView): boolean {
	if ((node.children?.length ?? 0) !== 0) return false;
	return tryGetBlockKindDescriptor(node.kind)?.blockFocus === 'whole-block';
}
