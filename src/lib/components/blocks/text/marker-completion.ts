/**
 * The space that finishes a container's marker. An opener firing on the bare marker byte
 * (`>`) mints the container before the space arrives, so that space belongs to the marker
 * and not to the empty child the caret landed in. Declared by the container
 * (`contentStartSpace`), never by kind name here.
 */

import { displayLength } from '../../../core/lines';
import { isProseKind } from '../../../core/inline';
import type { NodeView } from '../../../core/node-views';
import { tryGetBlockKindDescriptor } from '../../../schema/block-kind-descriptor';

/**
 * `parent` is the block's NEAREST ancestor container — a nested quote completes at its own
 * depth — or null at the document root. Byte shapes only, so the answer is stateless.
 */
export function completesContainerMarker(
	node: NodeView,
	parent: NodeView | null,
	caretOffset: number
): boolean {
	if (caretOffset !== 0 || !parent) return false;
	if (!isProseKind(node.kind) || displayLength(node.raw) !== 0) return false;
	return tryGetBlockKindDescriptor(parent.kind)?.contentStartSpace === 'complete-marker';
}
