import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

/**
 * Reserved-chrome predicates: the declaration-driven surface the model layer dispatches on
 * instead of a plugin kind name. These read a container's `reservedChrome` declaration, never
 * a hard-coded kind.
 */

/** The reserved chrome kind a container declares, or undefined if it declares none. */
export function reservedChromeKindOf(containerKind: AnyBlockKind): AnyBlockKind | undefined {
	return tryGetBlockKindDescriptor(containerKind)?.reservedChrome?.kind;
}

/** True when `childIndex` is the reserved chrome slot (index 0) of a chrome-declaring container. */
export function isReservedChromeChild(container: NodeView, childIndex: number): boolean {
	return childIndex === 0 && reservedChromeKindOf(container.kind) !== undefined;
}

/** True only when the kind declares an `isCollapsed` probe and it reports this node collapsed. */
export function isCollapsedContainer(node: NodeView): boolean {
	const probe = tryGetBlockKindDescriptor(node.kind)?.reservedChrome?.isCollapsed;
	return probe !== undefined && probe(node);
}

/**
 * The metadata patch that expands `node`, or null when its kind declares no door. Sibling of
 * `isCollapsedContainer` over the same declaration, so the clamp that hides a body and the
 * reveal that opens it cannot disagree about which containers collapse.
 */
export function expandContainerPatch(node: NodeView): Record<string, unknown> | null {
	const door = tryGetBlockKindDescriptor(node.kind)?.reservedChrome?.expandPatch;
	return door?.(node) ?? null;
}
