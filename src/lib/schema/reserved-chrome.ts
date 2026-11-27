import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	displayLength,
	oneLine,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import {
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor,
	type UnwrapRole,
	type WriteRule
} from './block-kind-descriptor';
import type { GrammarView } from './block-openers';
import {
	isDirectiveContainerKind,
	resolveDirective,
	startsContainerName
} from '../core/directive/registry';
import { matchDirectiveOpener } from '../core/directive/grammar';
import { DIRECTIVE_OPENER_LINE } from '../core/directive/container-shape';

/**
 * Checks for a container's reserved title row (its fixed first child): the row its `reservedChrome`
 * declares, or for a `:::` container the opener line the grammar gives it. The rest of the editor
 * asks here and never names a plugin kind.
 */

/** The title row kind a container has, or undefined if it has none. */
export function reservedChromeKindOf(containerKind: AnyBlockKind): AnyBlockKind | undefined {
	if (isDirectiveContainerKind(containerKind)) return DIRECTIVE_OPENER_LINE;
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
	return row ? row.raw.slice(0, rowContentRange(container, row).start) : '';
}

/** The title row's text, line ending aside, keeping only the title from offset `from` on: the
 *  marker always stays, and a row left with no title drops the spaces after the name. */
export function rowKeepingTitleFrom(container: NodeView, row: NodeView, from: number): string {
	const marker = rowMarker(container, row);
	const title = trimTrailingLineEnding(row.raw).slice(Math.max(from, marker.length));
	return title ? marker + title : withoutTrailingSpaces(marker);
}

/** The title row's text, line ending aside, up to offset `to`; a cut inside the marker keeps it. */
export function rowKeepingTitleTo(container: NodeView, row: NodeView, to: number): string {
	return trimTrailingLineEnding(row.raw).slice(0, Math.max(to, rowMarker(container, row).length));
}

/** The space to put before text typed at the end of an untitled row's held name, so it starts the
 *  title instead of a longer name no held one starts with; empty everywhere else. */
export function typedTitleGap(
	row: NodeView,
	index: number,
	written: string,
	container: () => NodeView | undefined,
	grammar: GrammarView
): string {
	// The row's own bytes first: the walk to its container is paid only by a line that could be one.
	const line = trimTrailingLineEnding(row.raw);
	const fence = index === 0 ? matchDirectiveOpener(line) : null;
	if (!fence || written.length <= line.length || !written.startsWith(line)) return '';
	const owner = container();
	if (!owner || !isReservedChromeChild(owner, index) || !rowIsOpenerLine(owner.kind)) return '';
	if (!resolveDirective('container', fence.name, grammar)) return '';
	// The grammar's own matcher says what joins a name, so a `!` or an `é` ends it as it reads.
	const joined = matchDirectiveOpener(written)!.name;
	return joined === fence.name || startsContainerName(joined, grammar) ? '' : ' ';
}

/** Where a backward word or line delete at `caret` on a `:::` opener row stops: the title's start,
 *  for a caret in a title past the gap; null elsewhere, an untitled name's end deleting as text. */
export function titleDeleteFloor(
	container: NodeView | null,
	index: number,
	row: NodeView,
	caret: number
): number | null {
	if (!container || !isReservedChromeChild(container, index) || !rowIsOpenerLine(container.kind)) {
		return null;
	}
	const fence = matchDirectiveOpener(trimTrailingLineEnding(row.raw));
	if (!fence || !/^[ \t]/.test(fence.info)) return null;
	const start = rowContentRange(container, row).start;
	return caret >= start ? start : null;
}

function withoutTrailingSpaces(text: string): string {
	return text.replace(/[ \t]+$/, '');
}

/** The write rule every title row takes by its position, after its kind's own: the row's text on
 *  {@link oneLine} (its last break dropped), then the row's own ending back on. */
export const titleRowWrite: WriteRule = {
	normalize: (raw, ctx) => oneLine(raw).text + ownTrailingLineEnding(ctx.node.raw),
	mapOffset: (raw, offset) => oneLine(raw).at(offset)
};

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
