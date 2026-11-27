/**
 * The two list item moves Tab and Shift+Tab make, as one commit each: nest an item under the item
 * above it, or lift a nested item out to its parent's list. A caret's own key and a range's both
 * run these, so one item moves the same way whichever asked. Writes go through the commit's scope
 * views only, never a node read before it.
 */

import type { CommitLanding, ContainerScope } from '../../action-contracts';
import { metadataOf, type CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { SharingState } from '../sharing';
import { docPathFrom } from '../../core/coordinate-spaces';
import { ensureUnsharedChild } from '../unshare';
import { trackChildIds } from '../structural-change';
import { spliceChildren } from '../children';
import { cascadeCleanupEmptyAncestors } from '../cleanup';
import {
	numberingOf,
	numberingOfList,
	renumberOrderedList,
	normalizeItemMarkerToList,
	type OrderedNumbering
} from './ordered-markers';
import { buildListShell } from './list-builders';
import { lacksSublistSeparator, settleSublistSeparator } from './sublist-separator';
import { isBlankText, ownTrailingLineEnding } from '../../core/lines';
import { keepingListOrder } from './keeping-order';
import { containerScopeState } from '../paste/parent-scope';
import type { MultiScopeTarget, PasteCommitCoordinator } from '../paste/paste-deps';

/** What a move commits through; a container that isn't mounted moves by its ids alone. */
export type ItemMoveCommits = Pick<PasteCommitCoordinator, 'commitMultiScope' | 'resolveState'>;

type Landed = ReturnType<CommitLanding>;

/** Nests item `itemIndex` of `list` at the end of the item above, in its last child when that's a
 *  same-kind sublist; `landing` gets the moved item's path below `list`. */
export function nestListItem(
	commits: ItemMoveCommits,
	list: MultiScopeTarget,
	itemIndex: number,
	landing: (movedTo: number[]) => Landed = () => null
): Promise<boolean> {
	const node = list.node;
	if (!node.children || itemIndex === 0) return Promise.resolve(false);

	const prevItem = node.children[itemIndex - 1];
	if (!prevItem.children) return Promise.resolve(false);

	const ordered = metadataOf(node, 'list').ordered;
	const lastIdx = prevItem.children.length - 1;
	const existingNestedIdx = isListOfKind(prevItem.children[lastIdx], ordered) ? lastIdx : -1;
	const existingNestedList =
		existingNestedIdx === -1 ? undefined : prevItem.children[existingNestedIdx];

	// One test, one destination: a matching sublist adopts the item whether or not it holds any yet,
	// so the scope list and the mutate branch cannot disagree about where it goes.
	const destination: MultiScopeTarget = existingNestedList
		? {
				node: existingNestedList,
				state: containerScopeState(commits, existingNestedList),
				path: [...list.path, itemIndex - 1, existingNestedIdx]
			}
		: {
				node: prevItem,
				state: containerScopeState(commits, prevItem),
				path: [...list.path, itemIndex - 1]
			};

	let movedTo: number[] = [];
	return commits.commitMultiScope({
		scopes: [list, destination],
		snapshot: { path: docPathFrom([...list.path, itemIndex]), offset: 0 },
		mutate: ([outerScope, destScope]) =>
			keepingListOrder(
				() => [outerScope.node],
				() => {
					const sharing = outerScope.sharing;
					const outerNumbering = numberingOfList(outerScope.node);
					const [movedItem] = outerScope.children.splice(itemIndex, 1);
					const at = destScope.children.length;
					movedTo = existingNestedList
						? [itemIndex - 1, existingNestedIdx, at]
						: [itemIndex - 1, at, 0];

					// Each branch renumbers the moved item's marker through `sharing`, which copies it first.
					if (existingNestedList) {
						const destList = destScope.node;
						const destNumbering = numberingOfList(destList);
						destScope.children.push(movedItem);
						// The item takes the sublist's marker style, as a paste does; a fresh list has none.
						const moved = ensureUnsharedChild(destList, destScope.children.length - 1, sharing);
						normalizeItemMarkerToList(moved, destList);
						renumberOrderedList(destList, destScope.children.length - 1, destNumbering, sharing);
					} else {
						const shell = buildListShell(ordered, [movedItem]);
						sharing.stamp(shell);
						destScope.children.push(shell);
						// Write, then read back (tree-operations/unshare.ts): the writes below go through the
						// value in the tree, not the list the proxy has observed.
						const destList = destScope.children[destScope.children.length - 1];
						renumberOrderedList(destList, 0, FRESH_LIST, sharing);
						// A new sublist sits below the commit's chain, which never rebuilds it; the blank-line
						// rule below reads its bytes too.
						destScope.rebuild(destList);
						settleSublistSeparator(destScope.children, destScope.children.length - 1);
					}
					renumberOrderedList(outerScope.node, itemIndex, outerNumbering, sharing);

					return [
						{ op: 'delete', at: itemIndex, count: 1 },
						{ op: 'insert', at: destScope.children.length - 1, count: 1 }
					];
				}
			),
		op: {
			kind: 'replaceBlock',
			detail: { action: 'indentItem', itemIndex },
			eventPath: docPathFrom(list.path)
		},
		landing: () => landing(movedTo)
	});
}

/** Lifts item `nestedItemIdx` of `nestedList`, a sublist of `outer`'s item `parentItemIdx`, to just
 *  after that item, taking everything after it there as its own children; `landing` gets its index. */
export function liftNestedItem(
	commits: ItemMoveCommits,
	outer: MultiScopeTarget,
	parentItemIdx: number,
	nestedList: NodeView,
	nestedItemIdx: number,
	landing: (promotedAt: number) => Landed = () => null
): Promise<boolean> {
	const node = outer.node;
	if (!node.children || !nestedList.children) return Promise.resolve(false);

	const parentItem = node.children[parentItemIdx];
	if (!parentItem?.children) return Promise.resolve(false);

	const nestedIdxInParent = parentItem.children.indexOf(nestedList);
	if (nestedIdxInParent === -1) return Promise.resolve(false);

	// The move can empty the nested list and then the parent item, so both are scopes.
	const scopes: MultiScopeTarget[] = [
		outer,
		{
			node: nestedList,
			state: containerScopeState(commits, nestedList),
			path: [...outer.path, parentItemIdx, nestedIdxInParent]
		},
		{
			node: parentItem,
			state: containerScopeState(commits, parentItem),
			path: [...outer.path, parentItemIdx]
		}
	];
	let promotedAt = parentItemIdx + 1;
	const at = { parentItemIdx, nestedIdxInParent, nestedItemIdx };

	return commits.commitMultiScope({
		scopes,
		// The promoted item's pre-move path (its nested-list slot).
		snapshot: {
			path: docPathFrom([...outer.path, parentItemIdx, nestedIdxInParent, nestedItemIdx]),
			offset: 0
		},
		mutate: (scopeViews) => {
			const [outerScope, nestedScope, parentScope] = scopeViews;
			// Opened before the move, since the cleanup in it can splice any of the three lists.
			const ledgers = scopeViews.map((v) => trackChildIds(v.node));
			promotedAt = liftItemOut(at, {
				outer: outerScope.node,
				nested: nestedScope.node,
				parent: parentScope.node,
				sharing: outerScope.sharing,
				rebuild: outerScope.rebuild,
				splice: outerScope.splice
			});
			return ledgers.map((ledger) => {
				const change = ledger.read();
				ledger.release();
				return change;
			});
		},
		op: {
			kind: 'replaceBlock',
			detail: { action: 'promoteNestedItem', parentItemIdx, nestedItemIdx },
			eventPath: docPathFrom(outer.path)
		},
		landing: () => landing(promotedAt)
	});
}

/** Where a nested item stands: item `nestedItemIdx` of the sublist at child `nestedIdxInParent` of
 *  item `parentItemIdx` of the outer list. */
export interface NestedItemAt {
	parentItemIdx: number;
	nestedIdxInParent: number;
	nestedItemIdx: number;
}

/** The three containers a lift writes, each one the caller owns, and how it writes the rest: through
 *  `sharing`, rebuilding a node off the caller's chain with `rebuild`, splicing below `outer` with
 *  `splice`. */
export interface LiftWrites extends Pick<ContainerScope, 'sharing' | 'rebuild' | 'splice'> {
	outer: CstNode;
	nested: CstNode;
	parent: CstNode;
}

/** The moves of `liftNestedItem`, made on `writes`: the item at `at` follows its parent item in
 *  `outer`, holding everything after it. Returns where it then stands in `outer`. */
export function liftItemOut(at: NestedItemAt, writes: LiftWrites): number {
	const { parentItemIdx, nestedIdxInParent, nestedItemIdx } = at;
	const { outer, nested, parent, sharing, rebuild } = writes;
	return keepingListOrder(
		() => [outer],
		() => {
			// The promoted item is moved and written (marker normalization, renumbering), so copy it
			// before it leaves the nested list.
			const item = ensureUnsharedChild(nested, nestedItemIdx, sharing);
			const outerNumbering = numberingOfList(outer);
			const nestedNumbering = numberingOfList(nested);
			const laterItems = nested.children!.slice(nestedItemIdx + 1);
			spliceChildren(nested, nestedItemIdx, 1 + laterItems.length, []);
			const laterBlocks = parent.children!.slice(nestedIdxInParent + 1);
			spliceChildren(parent, nestedIdxInParent + 1, laterBlocks.length, []);
			const ordered = metadataOf(nested, 'list').ordered;
			adoptAsLastChildren(item, laterItems, ordered, nestedNumbering, sharing, rebuild);
			appendLaterBlocks(item, laterBlocks, sharing);
			if (laterItems.length + laterBlocks.length > 0) rebuild(item);
			normalizeItemMarkerToList(item, outer);
			let promotedAt = parentItemIdx + 1;
			spliceChildren(outer, promotedAt, 0, [item]);

			// What the move emptied goes, up to this list, which now holds the promoted item.
			const outerCount = outer.children!.length;
			cascadeCleanupEmptyAncestors(outer, writes, [
				parentItemIdx,
				nestedIdxInParent,
				nestedItemIdx
			]);
			promotedAt -= outerCount - outer.children!.length;

			// The items left in the nested list are the ones above the lifted item, so they keep theirs.
			renumberOrderedList(outer, promotedAt, outerNumbering, sharing);
			return promotedAt;
		}
	);
}

/** The siblings after a lifted item become its last children: in its last child when that's a
 *  sublist of the same kind, else in a new one after everything it holds. */
function adoptAsLastChildren(
	item: CstNode,
	later: CstNode[],
	ordered: boolean,
	nestedNumbering: OrderedNumbering,
	sharing: SharingState,
	rebuild: (node: CstNode) => void
): void {
	if (later.length === 0 || !item.children) return;
	const last = item.children.length - 1;
	let first = 0;
	// A fresh sublist starts at 1 and counts the way the list the items came from did.
	let numbering = { ...FRESH_LIST, step: nestedNumbering.step };
	if (isListOfKind(item.children[last], ordered)) {
		const list = ensureUnsharedChild(item, last, sharing);
		numbering = numberingOfList(list);
		first = list.children!.length;
		spliceChildren(list, first, 0, later);
		for (let i = first; i < list.children!.length; i++) {
			normalizeItemMarkerToList(ensureUnsharedChild(list, i, sharing), list);
		}
	} else {
		const shell = buildListShell(ordered, later);
		sharing.stamp(shell);
		spliceChildren(item, item.children.length, 0, [shell]);
	}
	// Write, then read back (tree-operations/unshare.ts) before the writes below.
	const at = item.children.length - 1;
	const list = item.children[at];
	renumberOrderedList(list, first, numbering, sharing);
	rebuild(list);
	settleSublistSeparator(item.children, at);
}

/** What followed the lifted item's sublist inside its old parent item (a paragraph, another
 *  sublist) follows it in the lifted item, each block keeping the blank line it had above it. */
function appendLaterBlocks(item: CstNode, later: CstNode[], sharing: SharingState): void {
	if (later.length === 0 || !item.children?.length) return;
	const at = item.children.length;
	spliceChildren(item, at, 0, later);
	const trivia = separatorBelow(item.children[at - 1], item.children[at]);
	if (trivia !== null) {
		ensureUnsharedChild(item, at, sharing).leadingTrivia = trivia;
	} else if (lacksSublistSeparator(item.children, at)) {
		ensureUnsharedChild(item, at, sharing);
		settleSublistSeparator(item.children, at);
	}
}

/** The line `below` needs above it to read back where it now stands, or null to keep its own. */
function separatorBelow(above: CstNode, below: CstNode): string | null {
	// An item whose first line is empty ends at a blank line, so nothing it holds may follow one.
	if (above.kind === 'paragraph' && isBlankText(above.raw)) {
		return below.leadingTrivia === '' ? null : '';
	}
	// Two same-kind lists with no line between them would read back as one.
	const merges =
		above.kind === 'list' &&
		isListOfKind(below, metadataOf(above, 'list').ordered) &&
		below.leadingTrivia === '';
	return merges ? ownTrailingLineEnding(above.raw) : null;
}

/** A list a move creates starts at 1. */
const FRESH_LIST: OrderedNumbering = numberingOf(null, null);

function isListOfKind(node: NodeView | undefined, ordered: boolean): boolean {
	return node?.kind === 'list' && metadataOf(node, 'list').ordered === ordered;
}
