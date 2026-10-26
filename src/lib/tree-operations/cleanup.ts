import type { CstNode, Document } from '../core/nodes';
import type { ScopeWrites } from '../action-contracts';
import { mustHoldChild } from '../schema/block-kind-descriptor';

/**
 * Remove the containers a delete emptied, walking up from `deletedPath`'s parent (a path below
 * `root`, the node of `scope`) to the first that still holds a child; `root` itself is never
 * spliced.
 */
export function cascadeCleanupEmptyAncestors(
	root: CstNode | Document,
	scope: Pick<ScopeWrites, 'splice'>,
	deletedPath: readonly number[]
): void {
	for (let depth = deletedPath.length - 1; depth > 0; depth--) {
		let node: CstNode | undefined = root.children?.[deletedPath[0]];
		for (let i = 1; i < depth; i++) node = node?.children?.[deletedPath[i]];
		if (!node || !mustHoldChild(node.kind) || (node.children?.length ?? 0) > 0) return;
		scope.splice(deletedPath.slice(0, depth - 1), deletedPath[depth - 1], 1, []);
	}
}
