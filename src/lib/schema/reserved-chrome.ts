import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import {
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor,
	type UnwrapRole
} from './block-kind-descriptor';
import { isDirectiveContainerKind } from '../core/directive/registry';
import { DIRECTIVE_OPENER_LINE } from '../core/directive/container-shape';

/**
 * Checks for a container's reserved title row (its fixed first child): the row its `reservedChrome`
 * declares, or for a `:::` container the opener line the grammar gives it. The rest of the editor
 * asks here and never names a plugin kind.
 */

/** The title row kind a container has, or undefined if it has none. */
export function reservedChromeKindOf(containerKind: AnyBlockKind): AnyBlockKind | undefined {
	if (isDirectiveContainerKind(containerKind)) return DIRECTIVE_OPENER_LINE as AnyBlockKind;
	return tryGetBlockKindDescriptor(containerKind)?.reservedChrome?.kind;
}

/** Whether the container's title row is its opener line, so the row's offsets are the raw's own. */
export function rowIsOpenerLine(containerKind: AnyBlockKind): boolean {
	return isDirectiveContainerKind(containerKind);
}

/** The kind's Backspace roles; a title row is always kept, whichever first-child role it declares. */
export function unwrapRoleOf(kind: AnyBlockKind): UnwrapRole | undefined {
	const declared = tryGetBlockKindDescriptor(kind)?.unwrapRole;
	if (reservedChromeKindOf(kind) === undefined) return declared;
	return {
		firstChildBackspace: 'keep-reserved-chrome',
		middleChildBackspace: declared?.middleChildBackspace ?? 'default-merge'
	};
}

/** True when `childIndex` is the title row position (index 0) of a container declaring one. */
export function isReservedChromeChild(container: NodeView, childIndex: number): boolean {
	return childIndex === 0 && reservedChromeKindOf(container.kind) !== undefined;
}

/** The title part of a container's title row, as offsets into the row's raw: the row kind's
 *  content range, so a row holding the opener line leaves its `:::name` marker out. */
export function rowContentRange(
	container: NodeView,
	row: NodeView | undefined = container.children?.[0]
): { start: number; end: number } {
	if (!row) return { start: 0, end: 0 };
	const range = tryGetBlockKindDescriptor(row.kind)?.getContentRange;
	return range ? range(row) : { start: 0, end: displayLength(row.raw) };
}

/** The bytes in front of the title on a container's title row, the spaces after the name included;
 *  empty for a row that is all title. */
export function rowMarker(
	container: NodeView,
	row: NodeView | undefined = container.children?.[0]
): string {
	if (!row) return '';
	const start = rowContentRange(container, row).start;
	const spaces = /^[ \t]*/.exec(row.raw.slice(start))![0].length;
	return row.raw.slice(0, start + spaces);
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
 * The metadata change that expands `node`, or null when its kind declares none. It reads the same
 * declaration as `isCollapsedContainer`, so hiding a body and opening it cannot disagree.
 */
export function expandContainerPatch(node: NodeView): Record<string, unknown> | null {
	const door = tryGetBlockKindDescriptor(node.kind)?.reservedChrome?.expandPatch;
	return door?.(node) ?? null;
}
