/** The state a commit scoped to a container goes through, mounted or not. */

import type { NodeView } from '../../core/node-views';
import type { MultiScopeTarget, PasteCommitCoordinator } from './paste-deps';

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
