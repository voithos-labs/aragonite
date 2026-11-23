import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLength, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import {
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor,
	type UnwrapRole,
	type WriteRule
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

/** Where text put on a title row at `offset` lands, and the space it needs in front: a spot in or at
 *  the end of a `:::name` marker moves to the title's start, so the text never joins the name. */
export function titleInsertionPoint(
	container: NodeView,
	row: NodeView,
	offset: number
): { offset: number; gap: string } {
	const marker = rowMarker(container, row);
	const nameEnd = withoutTrailingSpaces(marker).length;
	const spaced = marker.length > nameEnd;
	if (nameEnd === 0 || offset > marker.length || (offset === marker.length && spaced)) {
		return { offset, gap: '' };
	}
	return { offset: marker.length, gap: spaced ? '' : ' ' };
}

function withoutTrailingSpaces(text: string): string {
	return text.replace(/[ \t]+$/, '');
}

/** Text as a title row holds it, on one line: a hard break goes whole, any other run of line
 *  breaks becomes one space, and a run at the end goes. A paste into a title takes it too. */
export function titleLine(text: string): string {
	return heldToOneLine(text).text;
}

/** The write rule every title row takes by its position, after its kind's own: {@link titleLine}
 *  over the row's text, ending as the row ends, so the row never runs into the line below. */
export const titleRowWrite: WriteRule = {
	normalize: (raw, ctx) =>
		titleLine(withoutOwnEnding(raw, ctx.node)) + ownTrailingLineEnding(ctx.node.raw),
	mapOffset: (raw, offset, ctx) => heldToOneLine(withoutOwnEnding(raw, ctx.node)).at(offset)
};

// A backslash run of odd length before a line ending is a hard break; its last backslash goes too.
const LINE_BREAKS = /(?<!\\)((?:\\\\)*)\\\r?\n|(?:\r?\n)+/g;

/** {@link titleLine}'s text, and where an offset in `text` lands in it. */
function heldToOneLine(text: string): { text: string; at(offset: number): number } {
	const cuts: { from: number; to: number; by: number }[] = [];
	let out = '';
	let last = 0;
	for (const match of text.matchAll(LINE_BREAKS)) {
		const from = match.index;
		const to = from + match[0].length;
		const by = match[1] ?? (to === text.length ? '' : ' ');
		out += text.slice(last, from);
		cuts.push({ from, to, by: by.length });
		out += by;
		last = to;
	}
	out += text.slice(last);
	return {
		text: out,
		at: (offset) => {
			let shift = 0;
			for (const cut of cuts) {
				if (offset <= cut.from) break;
				if (offset < cut.to) return cut.from + shift + Math.min(offset - cut.from, cut.by);
				shift += cut.by - (cut.to - cut.from);
			}
			return offset + shift;
		}
	};
}

/** `raw` less the row's own line ending, where it still ends with it. */
function withoutOwnEnding(raw: string, row: NodeView): string {
	const own = ownTrailingLineEnding(row.raw);
	return own && raw.endsWith(own) ? raw.slice(0, -own.length) : raw;
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
