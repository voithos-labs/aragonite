/**
 * Rebuilds container `raw` up a node's ancestors, looking up `descriptor.rebuildRaw`, so a
 * plugin container joins in by declaring one.
 */

import type { CstNode } from '../core/nodes';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import type { ChildRawChange } from './child-spans';

/**
 * Rebuild `raw` for every container along `path`, innermost first. The leaf at the end of `path`
 * is not rebuilt: callers change its raw before calling. An empty path rebuilds `root`.
 */
export function rebuildAncestryRaw(root: CstNode, path: number[]): void {
	if (path.length === 0) {
		rebuildContainerRaw(root);
		return;
	}

	const containers: CstNode[] = [];
	let current = root;
	for (let i = 0; i < path.length - 1; i++) {
		current = current.children![path[i]];
		containers.push(current);
	}

	for (let i = containers.length - 1; i >= 0; i--) {
		rebuildContainerRaw(containers[i]);
	}
	rebuildContainerRaw(root);
}

/**
 * Calls the `rebuildRaw` on the kind's descriptor; throws on a leaf. A caller walking a chain of
 * ancestors uses {@link rebuildContainerRawIfContainer} instead.
 */
export function rebuildContainerRaw(node: CstNode): void {
	const rebuild = tryGetBlockKindDescriptor(node.kind)?.rebuildRaw;
	if (!rebuild) {
		throw new Error(
			`rebuildContainerRaw: kind "${node.kind}" has no rebuildRaw; only container kinds are valid`
		);
	}
	rebuild(node);
}

/**
 * Rebuild `raw` when `node`'s descriptor has a `rebuildRaw`; does nothing otherwise. `changed`
 * names the one child that changed (`child-spans.ts`); a rebuilder that ignores it rebuilds all.
 */
export function rebuildContainerRawIfContainer(node: CstNode, changed?: ChildRawChange): void {
	tryGetBlockKindDescriptor(node.kind)?.rebuildRaw?.(node, changed);
}
