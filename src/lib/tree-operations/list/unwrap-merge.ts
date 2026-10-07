/**
 * Unwrapping a list's first item, and merging a later item into the deepest text leaf of the one
 * before it. Both rewrite the item's marker line only; every other line keeps its bytes, and the
 * ordered-marker sequence runs on (`docs/design/editor.md` § Container unwrap).
 */

import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { Reading } from '../../schema/reading';
import { metadataOf } from '../../core/nodes';
import { splitLines, trailingLineEnding } from '../../core/lines';
import { joinIntoLeaf } from '../node-ops';
import type { SharingState } from '../sharing';
import { cloneNode } from '../clone';
import { parseContainerRaw } from '../../schema/container-raw';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildListRaw } from '../../schema/container-rebuilders';
import { walkToDeepestMergeLeaf } from '../../schema/merge-rules';
import { renumberOrderedList } from './ordered-markers';
import { dissolveItem } from './item-partition';
import { keepingListOrder } from '../../invariants/list-move-keeps-order';
import { leafTextAround, leafTexts } from '../../invariants/leaf-text';
import { assignChildIdsDeep } from '../../block-id';
import { replacePreservingFirst, type StructuralChange } from '../structural-change';

/**
 * Unwrap a list's first item without mutating the input: its children in the order they read, then
 * the rest of the list, which joins the sublist items when they come last.
 */
export function unwrapFirstItemFromList(list: NodeView): CstNode[] {
	if (list.kind !== 'list' || !list.children || list.children.length === 0) {
		return [];
	}

	const firstItem = list.children[0];
	if (!firstItem.children || firstItem.children.length === 0) {
		const clonedList: CstNode = cloneNode(list);
		const rest = clonedList.children!.slice(1);
		if (rest.length === 0) return [];
		clonedList.children = rest;
		// childIds pairs by index, so it slices with the children or every survivor
		// inherits its predecessor's id.
		clonedList.childIds = clonedList.childIds?.slice(1);
		rebuildListRaw(clonedList);
		return [clonedList];
	}

	return dissolveItem(list, 0).blocks;
}

/** The merge target's path; null when no prose leaf is reachable. */
function findDeepestVisibleTextTarget(list: CstNode, targetItemIndex: number): number[] | null {
	if (!list.children || targetItemIndex < 0 || targetItemIndex >= list.children.length) {
		return null;
	}
	const startItem = list.children[targetItemIndex];
	const result = walkToDeepestMergeLeaf(startItem, [targetItemIndex]);
	return result ? result.path : null;
}

/** Merge the item at `currentIndex` into the preceding item's last prose leaf, mutating `list`;
 *  null when there is nothing to join, and the caller falls back. A bad `currentIndex` throws. */
export function mergeListItemIntoPrevious(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	sharing: SharingState,
	reading: Reading
): MergeResult | null {
	// Targeting may read `list.children`, but the final splice must land in `children`
	// (`node-primitives.ts` header).
	if (
		list.kind !== 'list' ||
		!list.children ||
		currentIndex <= 0 ||
		currentIndex >= children.length
	) {
		throw new Error(`mergeListItemIntoPrevious: invalid currentIndex ${currentIndex}`);
	}
	const targetPath = findDeepestVisibleTextTarget(list, currentIndex - 1);
	const target = targetPath ? nodeAt(list, targetPath) : null;
	const absorbed = children[currentIndex].children?.[0] ?? null;
	// The join rewrites the lines it joins (a live-mode join can drop markers, a line below can
	// continue the joined paragraph), so the order check reads the text around them.
	let around: readonly string[] = [];
	return keepingListOrder(
		() => (around = leafTextAround([list], target, absorbed)),
		() => mergeMarkerLine(list, children, currentIndex, targetPath, sharing, reading),
		() => {
			const text = leafTexts([list]).join('');
			return [text.slice(0, around[0].length), text.slice(text.length - around[1].length)];
		}
	);
}

type MergeResult = {
	mergePoint: { targetPath: number[]; offset: number };
	change: StructuralChange;
};

function mergeMarkerLine(
	list: CstNode,
	children: CstNode[],
	currentIndex: number,
	targetPath: number[] | null,
	sharing: SharingState,
	reading: Reading
): MergeResult | null {
	if (!targetPath || !list.children) return null;
	const currentItem = children[currentIndex];
	const absorbed = currentItem.children?.[0];
	if (absorbed?.kind !== 'paragraph') return null;
	// Lines that would read outside the list have nowhere to go, so the merge declines.
	if (!readAsList(bytesWithoutMarkerLine(children, currentIndex), list, reading.grammar)) {
		return null;
	}

	// The target has the current item below it, so it closes its line with the document's ending.
	const lineEnding = trailingLineEnding(nodeAt(list, targetPath).raw, '\n');
	const body = { children: list.children, owner: list, lineEnding };
	const joined = joinIntoLeaf(body, targetPath, absorbed, reading, sharing);
	if (!joined) return null;

	// Only the marker line goes; every line under it keeps its bytes and reads where it now stands.
	const reread = readAsList(bytesWithoutMarkerLine(children, currentIndex), list, reading.grammar);
	if (!reread?.children)
		throw new Error('mergeListItemIntoPrevious: the joined list no longer reads as one');
	assignChildIdsDeep(reread);
	const change = changeAcross(children, reread.children);
	children.length = 0;
	for (const item of reread.children) {
		sharing.stamp(item);
		children.push(item);
	}
	// So the reads below see the new shape; idempotent with the commit's final write to state.
	list.children = children;

	if (metadataOf(list, 'list')?.ordered) {
		// The merge only removes a non-first item, so children[0] keeps the list's starting number;
		// renumber from 1 to continue it rather than resetting the sequence.
		renumberOrderedList(list, 1, sharing);
	}

	return { mergePoint: { targetPath, offset: joined.joinOffset }, change };
}

/** The list's bytes with item `index`'s marker line and its own text gone, the lines under it as
 *  they stood; its blank line above goes with the marker line. */
function bytesWithoutMarkerLine(items: readonly NodeView[], index: number): string {
	let bytes = '';
	for (let i = 0; i < items.length; i++) {
		bytes += i === index ? linesBelowOwnText(items[i]) : items[i].leadingTrivia + items[i].raw;
	}
	return bytes;
}

/** An item's lines below its own first block, as they stand in the list. */
function linesBelowOwnText(item: NodeView): string {
	const own = splitLines(item.children![0].raw).length;
	const lines = splitLines(item.raw);
	return lines.length > own ? item.raw.slice(lines[own - 1].end) : '';
}

/** The list `bytes` read as, when they still read as one list of `list`'s kind. */
function readAsList(bytes: string, list: NodeView, grammar: GrammarView): CstNode | null {
	const blocks = parseContainerRaw(bytes, grammar);
	const ordered = (node: NodeView) => metadataOf(node, 'list')?.ordered ?? false;
	const [reread] = blocks;
	const one = blocks.length === 1 && reread.kind === 'list' && ordered(reread) === ordered(list);
	return one ? reread : null;
}

/** The items the merge changed, from the first that differs to the last: the first keeps its id,
 *  since the merged text joined it. */
function changeAcross(before: readonly NodeView[], after: readonly NodeView[]): StructuralChange {
	const same = (a: NodeView, b: NodeView) =>
		a.kind === b.kind && a.leadingTrivia === b.leadingTrivia && a.raw === b.raw;
	const shorter = Math.min(before.length, after.length);
	let head = 0;
	while (head < shorter && same(before[head], after[head])) head++;
	let tail = 0;
	while (
		tail < shorter - head &&
		same(before[before.length - 1 - tail], after[after.length - 1 - tail])
	) {
		tail++;
	}
	return replacePreservingFirst(head, before.length - head - tail, after.length - head - tail);
}

/** The node at `path` below `root`, re-read through the tree. */
function nodeAt(root: CstNode, path: readonly number[]): CstNode {
	let node = root;
	for (const index of path) node = node.children![index];
	return node;
}
