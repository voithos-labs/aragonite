/**
 * Ancestry dispatch for container raw rebuilds — looks up
 * `descriptor.rebuildRaw`, so plugin containers participate by declaring one.
 */

import type { CstNode } from '../core/nodes';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

/**
 * Rebuild `raw` for every container along `path`, innermost first. The leaf at the tail of
 * `path` is NOT rebuilt — callers mutate its raw before calling. Empty path rebuilds `root`.
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
 * Dispatch via the kind's descriptor `rebuildRaw`; throws on a leaf. Callers walking ancestry
 * chains use {@link rebuildContainerRawIfContainer} instead.
 */
export function rebuildContainerRaw(node: CstNode): void {
	const rebuild = tryGetBlockKindDescriptor(node.kind)?.rebuildRaw;
	if (!rebuild) {
		throw new Error(
			`rebuildContainerRaw: kind "${node.kind}" has no rebuildRaw — only container kinds are valid`
		);
	}
	rebuild(node);
}

/** Rebuild `raw` when `node` has a rebuildRaw on its descriptor; no-op otherwise. */
export function rebuildContainerRawIfContainer(node: CstNode): void {
	tryGetBlockKindDescriptor(node.kind)?.rebuildRaw?.(node);
}
