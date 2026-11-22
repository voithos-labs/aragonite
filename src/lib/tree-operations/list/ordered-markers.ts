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

/** Read an item's marker as an integer base, defaulting to 1 for a non-numeric marker or a
 *  block that is not a list item. */
export function orderedBaseOf(item: NodeView | undefined): number {
	if (!item) return 1;
	const marker = metadataIfKind(item, 'listItem')?.marker ?? '';
	const n = parseInt(marker, 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

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

// ── Renumbering ──────────────────────────────────────────────────────────────

/** Increment an ordered marker's numeric prefix, preserving its suffix. */
export function bumpOrderedMarker(marker: string): string {
	return marker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
}

/** Renumber an ordered list from `fromIndex` on, any other block left as it is. Item 0 keeps the
 *  list's start; an edit that moves, removes or creates item 0 calls `renumberOrderedListFrom`. */
export function renumberOrderedList(
	list: CstNode,
	fromIndex: number,
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (!list.children) return;
	if (!metadataIfKind(list, 'list')?.ordered) return;
	// Each item is copied out of the undo snapshot and written before the tree holds it, since a
	// write through the tree's `$state` proxy is paid once per item below the edit.
	for (let j = Math.max(fromIndex, 1); j < list.children.length; j++) {
		const prevNum = parseInt(metadataOf(list.children[j - 1], 'listItem').marker, 10) || 0;
		writeUnsharedChild(list, j, sharing, (item) => {
			const meta = metadataOf(item, 'listItem');
			meta.marker = String(prevNum + 1) + meta.marker.replace(/^\d+/, '');
			writeContainerRaw(item, grammar);
		});
	}
}

/** Renumber a whole ordered list from `start`, keeping marker suffixes. A caller reads `start`
 *  before its edit when that edit moves or removes the first item. */
export function renumberOrderedListFrom(
	list: CstNode,
	start: number,
	sharing: SharingState,
	grammar: GrammarView
): void {
	if (!metadataIfKind(list, 'list')?.ordered) return;
	if (!list.children || list.children.length === 0) return;
	writeUnsharedChild(list, 0, sharing, (first) => {
		const meta = metadataOf(first, 'listItem');
		meta.marker = String(start) + (meta.marker.replace(/^\d+/, '') || '. ');
		writeContainerRaw(first, grammar);
	});
	renumberOrderedList(list, 1, sharing, grammar);
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
	const start = orderedBaseOf(before[0]);
	return (sharing, grammar) => {
		const after = list.children ?? [];
		if (after.length >= before.length) return;
		let shifted = 0;
		while (shifted < after.length && after[shifted] === before[shifted]) shifted++;
		if (shifted === after.length) return;
		if (shifted === 0) renumberOrderedListFrom(list, start, sharing, grammar);
		else renumberOrderedList(list, shifted, sharing, grammar);
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
 *  ordered list, the number after the item above, written once before the tree holds it. */
export function joinItemsToList(
	list: CstNode,
	from: number,
	sharing: SharingState,
	grammar: GrammarView
): void {
	const ordered = metadataIfKind(list, 'list')?.ordered ?? false;
	for (let j = from; j < list.children!.length; j++) {
		const above = j === 0 ? undefined : list.children![j - 1];
		const prevNum = above ? parseInt(metadataOf(above, 'listItem').marker, 10) || 0 : 0;
		writeUnsharedChild(list, j, sharing, (item) => {
			const meta = metadataOf(item, 'listItem');
			const styled = styledAs(list, meta.marker);
			// An ordered item is written even where its marker stands, as a renumber writes it.
			if (!ordered && styled === meta.marker) return;
			meta.marker = ordered ? String(prevNum + 1) + styled.replace(/^\d+/, '') : styled;
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
