import type { AnyBlockKind, CstNode } from '../core/nodes';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';

/**
 * Reserved-chrome predicates — the declaration-driven surface the model layer
 * dispatches on instead of a plugin kind name. A container declares its child 0
 * as reserved chrome via `reservedChrome` on its descriptor; these read that
 * declaration, never a hard-coded kind.
 */

/** The reserved chrome kind a container declares, or undefined if it declares none. */
export function reservedChromeKindOf(containerKind: AnyBlockKind): AnyBlockKind | undefined {
	return tryGetBlockKindDescriptor(containerKind)?.reservedChrome?.kind;
}

/** True when `childIndex` is the reserved chrome slot (index 0) of a chrome-declaring container. */
export function isReservedChromeChild(container: CstNode, childIndex: number): boolean {
	return childIndex === 0 && reservedChromeKindOf(container.kind) !== undefined;
}
