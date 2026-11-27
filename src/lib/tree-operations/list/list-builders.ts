/** Constructors for list and listItem CST nodes. */

import {
	metadataOf,
	type CstNode,
	type ListItemMetadata,
	type ListMetadata
} from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import {
	indentColumns,
	isBlankLine,
	trailingLineEnding,
	trimTrailingLineEnding
} from '../../core/lines';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import { writeContainerRaw } from '../../schema/container-writer';
import { readItemShape } from '../../core/parsers/list';
import { cloneMetadata } from '../clone';
import { bumpOrderedMarker, renumberOrderedList, type OrderedNumbering } from './ordered-markers';
import { createSharingState } from '../sharing';
import { assignIds } from '../../block-id';
import { markerLineWidening } from './task-paragraph';
import type { GrammarView } from '../../schema/block-openers';
import { adoptOwnReading } from '../../schema/container-raw';
import { emptyParagraph } from '../node-primitives';

// ── List / item construction ─────────────────────────────────────────────────

/** A list node carrying `items` in place, mirroring `template`'s metadata and affixes, numbered by
 *  `numbering` or, where it is null, keeping the numbers they have. */
export function assembleListHalf(
	template: NodeView,
	items: CstNode[],
	numbering: OrderedNumbering | null,
	grammar: GrammarView
): CstNode {
	const half: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata
			? (cloneMetadata(template.metadata) as ListMetadata)
			: { ordered: false },
		children: items,
		childIds: assignIds(items),
		innerPrefix: template.innerPrefix ?? '',
		innerSuffix: template.innerSuffix ?? ''
	};
	if (items[0]) items[0].leadingTrivia = '';
	// The caller owns the items, so a fresh sharing state copies none of them.
	if (numbering) renumberOrderedList(half, 0, numbering, createSharingState(), grammar);
	rebuildListRaw(half);
	return half;
}

/** The marker and checkbox of the item Enter opens after an item: its marker bumped by its list's
 *  step, its task checkbox inherited unchecked. */
export function followerMetadata(
	prevMeta: ListItemMetadata | undefined,
	numbering: OrderedNumbering
): ListItemMetadata {
	const inheritTask = prevMeta?.taskItem === true;
	return {
		marker: bumpOrderedMarker(prevMeta?.marker ?? '- ', numbering.step),
		taskItem: inheritTask,
		taskChecked: false,
		taskMarker: inheritTask ? '[ ] ' : null
	};
}

/** A listItem mirroring `template`'s metadata, affixes and bytes, so lines it keeps keep their
 *  spelling, then holding what those bytes read as. Clone any `children` the tree still holds. */
export function buildListItemWithContent(
	template: NodeView,
	children: CstNode[],
	grammar: GrammarView
): CstNode {
	const metadata = template.metadata
		? (cloneMetadata(template.metadata) as ListItemMetadata)
		: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null };
	return mintListItem(metadata, template, children, grammar);
}

/** A listItem from explicit metadata with empty affixes, starting from the bytes of `source` when
 *  `children` came out of it, and then holding what those bytes read as. */
export function buildListItem(
	metadata: ListItemMetadata,
	children: CstNode[],
	grammar: GrammarView,
	source?: NodeView
): CstNode {
	const affixes = { raw: source?.raw ?? '', innerPrefix: '', innerSuffix: '' };
	return mintListItem(metadata, affixes, children, grammar);
}

// Affixes are set before the rebuild, which derives the item's raw from them and `source.raw`.
function mintListItem(
	metadata: ListItemMetadata,
	source: Pick<NodeView, 'raw' | 'innerPrefix' | 'innerSuffix'>,
	children: CstNode[],
	grammar: GrammarView
): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: source.raw,
		metadata,
		innerPrefix: source.innerPrefix ?? '',
		children,
		childIds: assignIds(children),
		innerSuffix: source.innerSuffix ?? ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	writeContainerRaw(item, grammar);
	// A first line the marker line doesn't hold as this item takes the wider marker it reads as,
	// or else opens below an empty marker (`docs/design/structural-edits.md` § The container `raw` contract).
	if (adoptOwnReading(item, grammar)) return item;
	if (takeWidenedMarker(item, grammar) && adoptOwnReading(item, grammar)) return item;
	openBelowMarker(item, grammar);
	adoptOwnReading(item, grammar);
	return item;
}

/** `item` takes the marker its first line reads as, the spaces it widens over moving off the
 *  first block, and its lines at its content column move with that column. */
function takeWidenedMarker(item: CstNode, grammar: GrammarView): boolean {
	const widened = markerLineWidening(item, grammar);
	if (!widened) return false;
	const column = (readItemShape(item.raw)?.indent.length ?? 0) + widened.width.from;
	const first = item.children![0];
	item.metadata = widened.metadata;
	first.raw = first.raw.slice(widened.taken);
	item.raw = shiftedBelowFirst(item.raw, column, widened.width.to - widened.width.from);
	writeContainerRaw(item, grammar);
	return true;
}

/** `raw` with every line after the first that sits at `column` moved `grow` columns right; a
 *  blank line, or a lazy one left of the column, continues where it stands. */
function shiftedBelowFirst(raw: string, column: number, grow: number): string {
	if (grow <= 0) return raw;
	const lines = raw.split(/(?<=\n)/);
	const pad = ' '.repeat(grow);
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!isBlankLine(trimTrailingLineEnding(line)) && indentColumns(line) >= column)
			lines[i] = pad + line;
	}
	return lines.join('');
}

/** `item` with an empty first line, its blocks below it: a first line no marker holds (a line of
 *  dashes reads as a divider) reads as the item's own there. */
function openBelowMarker(item: CstNode, grammar: GrammarView): void {
	const children = item.children!;
	children.unshift(emptyParagraph('', trailingLineEnding(children[0]?.raw ?? '', '\n')));
	item.childIds = assignIds(children);
	rewriteFromOpener(item, grammar);
}

/** Rebuilds `item` from its opener line alone, so no line below keeps a column it was written at. */
function rewriteFromOpener(item: CstNode, grammar: GrammarView): void {
	const { marker, taskMarker } = metadataOf(item, 'listItem');
	item.raw = (readItemShape(item.raw)?.indent ?? '') + marker + (taskMarker ?? '');
	writeContainerRaw(item, grammar);
}

/**
 * A bare list shell that neither renumbers nor rebuilds raw; a live-tree caller does both through
 * `sharing`, so the moved items are copied before being written.
 */
export function buildListShell(ordered: boolean, children: CstNode[]): CstNode {
	const metadata: ListMetadata = { ordered };
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata,
		children,
		childIds: assignIds(children)
	};
}
