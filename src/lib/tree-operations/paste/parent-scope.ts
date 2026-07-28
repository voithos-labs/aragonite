/**
 * The commit scope a paste addresses when it re-mints or splices a block: the
 * block's PARENT container, resolved from the path itself rather than from
 * whatever `blockEdit` happens to be in scope — a caller holding a nested-bundle
 * blockEdit (a row-level bundle for a cell's path) would otherwise misroute
 * through the wrong container.
 */

import type { CstNode, Document } from '../../core/nodes';
import { nodeAt } from '../node-ops';
import { devWarn } from '../../dev-warn';
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

/**
 * A container's mounted `BlockListState`, or a detached stand-in. The strict
 * `expectState` throws, and every paste route reaching one of these can be a
 * cross-block paste whose range delete ALREADY committed — the throw would leave
 * the selection deleted and no paste landed. The ceremony writes a container
 * scope's ids to the owned node's `childIds`, not to the state bundle, so the
 * childIds/children realignment still happens on the stand-in; only ref alignment
 * is unavailable, which is already true of a container nothing has mounted.
 */
export function containerScopeState(
	controller: PasteCommitCoordinator,
	node: CstNode
): MultiScopeTarget['state'] {
	const mounted = controller.resolveState(node);
	if (mounted) return mounted;
	devWarn(
		'paste',
		`committing at an unmounted ${node.kind} scope — ids realign, component refs do not`
	);
	return { innerBlockIds: [...(node.childIds ?? [])], innerBlockRefs: [] };
}
