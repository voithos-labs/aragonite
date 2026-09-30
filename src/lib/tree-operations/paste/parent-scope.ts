/**
 * The commit scope a paste addresses when it splices at a block's parent container, resolved from
 * the path rather than from whatever `blockEdit` is in scope, since a caller holding a nested
 * bundle's `blockEdit` would go through the wrong container.
 */

import type { CstNode, Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { nodeAt } from '../node-primitives';
import type { MultiScopeTarget, PasteCommitCoordinator } from './paste-deps';

/** Null when `blockPath`'s parent doesn't resolve to a container. */
export function resolveParentScope(
	doc: Document,
	blockPath: number[],
	controller: PasteCommitCoordinator
): MultiScopeTarget | null {
	const parentPath = blockPath.slice(0, -1);
	if (parentPath.length === 0) return controller.getDocScope();
	const parentNode = nodeAt(doc, parentPath) as CstNode | null;
	if (!parentNode?.children) return null;
	return {
		node: parentNode,
		state: containerScopeState(controller, parentNode),
		path: parentPath
	};
}

/** A container's mounted `BlockListState`, or its ids and no refs: unmounted is normal after a
 *  gesture's earlier commit, and every caller lands its caret by path, so no ref is missed. */
export function containerScopeState(
	controller: Pick<PasteCommitCoordinator, 'resolveState'>,
	node: NodeView
): MultiScopeTarget['state'] {
	return (
		controller.resolveState(node) ?? {
			innerBlockIds: [...(node.childIds ?? [])],
			innerBlockRefs: []
		}
	);
}
