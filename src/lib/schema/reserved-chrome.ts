import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { tryGetBlockKindDescriptor, type BlockKindDescriptor } from './block-kind-descriptor';

/**
 * Checks for a container's reserved chrome (its fixed first child). The rest of the editor asks
 * these instead of naming a plugin kind: they read a container's `reservedChrome` declaration,
 * never a hard-coded kind.
 */

/** The reserved chrome kind a container declares, or undefined if it declares none. */
export function reservedChromeKindOf(containerKind: AnyBlockKind): AnyBlockKind | undefined {
	return tryGetBlockKindDescriptor(containerKind)?.reservedChrome?.kind;
}

/** True when `childIndex` is the reserved chrome position (index 0) of a container declaring one. */
export function isReservedChromeChild(container: NodeView, childIndex: number): boolean {
	return childIndex === 0 && reservedChromeKindOf(container.kind) !== undefined;
}

/** True only when the kind declares an `isCollapsed` check and that check reports it collapsed. */
export function isCollapsedContainer(node: NodeView): boolean {
	return isCollapsedByDescriptor(tryGetBlockKindDescriptor(node.kind), node);
}

/** How many of `node`'s children a caret can reach: all of them, or only the title row while the
 *  container is collapsed, so its last reachable child is this count minus one. */
export function caretChildCount(node: NodeView): number {
	const count = node.children?.length ?? 0;
	return count > 0 && isCollapsedContainer(node) ? 1 : count;
}

/** The same answer for a caller that already holds the descriptor: the height estimator runs per
 *  node, where a second registry lookup would cost one per block of the document. */
export function isCollapsedByDescriptor(
	descriptor: BlockKindDescriptor | undefined,
	node: NodeView
): boolean {
	const probe = descriptor?.reservedChrome?.isCollapsed;
	return probe !== undefined && probe(node);
}

/**
 * The metadata change that expands `node`, or null when its kind declares no way to expand. It
 * reads the same declaration as `isCollapsedContainer`, so the code that hides a body and the code
 * that opens it cannot disagree about which containers collapse.
 */
export function expandContainerPatch(node: NodeView): Record<string, unknown> | null {
	const door = tryGetBlockKindDescriptor(node.kind)?.reservedChrome?.expandPatch;
	return door?.(node) ?? null;
}
