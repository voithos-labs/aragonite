/** List marker bookkeeping: reads, renumbering, and matching item style to a list. A pass over many
 *  items writes each one before the tree holds it (`writeUnsharedChild`). */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { metadataIfKind, metadataOf } from '../../core/nodes';
import type { SharingState } from '../sharing';
import { writeContainerRaw } from '../../schema/container-writer';
import type { GrammarView } from '../../schema/block-openers';
import { writeUnsharedChild } from '../unshare';

// ── Marker reads ─────────────────────────────────────────────────────────────

/** Whether GFM reads `lower` as continuing `upper`'s list once nothing parts the two items: the
 *  same bullet character, or the same ordered delimiter. A task item is a bullet item. */
export function itemsShareList(upper: NodeView | undefined, lower: NodeView | undefined): boolean {
	const a = markerOf(upper);
	const b = markerOf(lower);
	const ordered = (marker: string) => /^\d/.test(marker);
	return a !== '' && b !== '' && ordered(a) === ordered(b) && a.at(-1) === b.at(-1);
}

const markerOf = (item: NodeView | undefined): string =>
	item ? (metadataOf(item, 'listItem')?.marker ?? '').trimEnd() : '';

/** An item's number, or null for a marker with no digits or a block that is not a list item. */
function numberOf(item: NodeView | undefined): number | null {
	const digits = /^\d+/.exec(item ? (metadataIfKind(item, 'listItem')?.marker ?? '') : '');
	return digits ? Number(digits[0]) : null;
}

// ── Renumbering ──────────────────────────────────────────────────────────────

/** How an ordered list counts, read off the numbers its author wrote before an edit. A renumber
 *  needs it read before the edit changes the list's first two items. */
export interface OrderedNumbering {
	readonly start: number;
	readonly step: 0 | 1;
}

/** The numbering of a list whose first two numbers are `first` and `second`: it starts at
 *  `first` (1 when there is none) and steps by 0 when the two match, else by 1. */
export function numberingOf(first: number | null, second: number | null): OrderedNumbering {
	return { start: first ?? 1, step: first !== null && first === second ? 0 : 1 };
}

/** `list`'s numbering as it stands. */
export function numberingOfList(list: NodeView): OrderedNumbering {
	const items = list.children ?? [];
	return numberingOf(numberOf(items[0]), numberOf(items[1]));
}

/** The number item `index` of `list` takes under `numbering`: the start for item 0, else the
 *  number of the item above it plus the step. */
export function numberAt(list: NodeView, index: number, numbering: OrderedNumbering): number {
	if (index === 0) return numbering.start;
	return (numberOf(list.children?.[index - 1]) ?? 0) + numbering.step;
}

/** The marker one past `marker` in a list stepping by `step`, keeping its suffix. */
export function bumpOrderedMarker(marker: string, step: 0 | 1): string {
	return marker.replace(/^(\d+)/, (_, n) => String(Number(n) + step));
}

/** Renumber an ordered list from item `from` on by `numbering` (see `numberAt`), any other block
 *  left as it is; the items above `from` keep their numbers. */
export function renumberOrderedList(
	list: CstNode,
	from: number,
	numbering: OrderedNumbering,
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (!list.children || !metadataIfKind(list, 'list')?.ordered) return;
	let number = numberAt(list, from, numbering);
	for (let j = from; j < list.children.length; j++, number += numbering.step) {
		const marker = metadataOf(list.children[j], 'listItem').marker;
		const target = String(number) + (marker.replace(/^\d+/, '') || '. ');
		if (marker === target) continue;
		// Each item is copied out of the undo snapshot and written before the tree holds it, since a
		// write through the tree's `$state` proxy is paid once per item below the edit.
		writeUnsharedChild(list, j, sharing, (item) => {
			metadataOf(item, 'listItem').marker = target;
			writeContainerRaw(item, grammar);
		});
	}
}

/** Reads an ordered list's numbering before items are removed from it, and returns the renumber
 *  to run after: from the first item the removal shifted, a new first item taking the start. */
export function holdOrderedNumbering(
	list: CstNode
): (sharing: SharingState, grammar: GrammarView) => void {
	if (!metadataIfKind(list, 'list')?.ordered || !list.children) {
		return keepNumbering;
	}
	const before = list.children.slice();
	const numbering = numberingOfList(list);
	return (sharing, grammar) => {
		const after = list.children ?? [];
		if (after.length >= before.length) return;
		let shifted = 0;
		while (shifted < after.length && after[shifted] === before[shifted]) shifted++;
		if (shifted < after.length) renumberOrderedList(list, shifted, numbering, sharing, grammar);
	};
}

const keepNumbering = (): void => {};

// ── Style templating ─────────────────────────────────────────────────────────

/**
 * Rewrite `item`'s marker glyph and suffix to match `parentList`'s first item; the number is left
 * to the caller's renumber pass.
 */
export function normalizeItemMarkerToList(
	item: CstNode,
	parentList: CstNode,
	grammar: GrammarView
): void {
	const meta = metadataOf(item, 'listItem');
	const target = styledAs(parentList, meta.marker);
	if (meta.marker === target) return;
	meta.marker = target;
	writeContainerRaw(item, grammar);
}

/** Items `from` on, which a move appended to `list`: each takes the list's marker style and, in an
 *  ordered list, its number by `numbering` (read before the move), written before the tree holds it. */
export function joinItemsToList(
	list: CstNode,
	from: number,
	numbering: OrderedNumbering,
	sharing: SharingState,
	grammar: GrammarView
): void {
	const ordered = metadataIfKind(list, 'list')?.ordered ?? false;
	let number = numberAt(list, from, numbering);
	for (let j = from; j < list.children!.length; j++, number += numbering.step) {
		const marker = metadataOf(list.children![j], 'listItem').marker;
		const styled = styledAs(list, marker);
		const target = ordered ? String(number) + (styled.replace(/^\d+/, '') || '. ') : styled;
		if (target === marker) continue;
		writeUnsharedChild(list, j, sharing, (item) => {
			metadataOf(item, 'listItem').marker = target;
			writeContainerRaw(item, grammar);
		});
	}
}

/** `marker` in `parentList`'s style: its first item's glyph and suffix, an ordered number kept. */
function styledAs(parentList: NodeView, marker: string): string {
	const parentOrdered = metadataOf(parentList, 'list')?.ordered ?? false;
	const itemOrdered = /^\d/.test(marker);
	const siblings = parentList.children ?? [];
	const templateMarker =
		siblings.length > 0 ? metadataOf(siblings[0], 'listItem').marker : undefined;

	let target: string;
	if (parentOrdered) {
		const suffix = templateMarker?.replace(/^\d+/, '');
		target = itemOrdered ? marker.replace(/\D.*$/, '') + (suffix || '. ') : '1' + (suffix ?? '. ');
	} else {
		target = templateMarker ?? '- ';
	}
	return keepingWidth(target, marker);
}

/** `target`, keeping `current`'s run of spaces when it is the wider one: those spaces are the
 *  item's own bytes, which a reload reads into its marker. */
function keepingWidth(target: string, current: string): string {
	const own = / *$/.exec(current)![0];
	const theirs = / *$/.exec(target)![0];
	return own.length > theirs.length ? target.slice(0, target.length - theirs.length) + own : target;
}
