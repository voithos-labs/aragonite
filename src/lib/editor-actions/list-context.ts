/**
 * The ListContext a ListBlock provides to its child ListItemBlocks. Every edit goes through
 * `commitMultiScope`, whose copied scope views are the only legal write targets, never the
 * `deps.scope.node` read before the commit.
 */

import type { BlockEditActions, FocusActions, ListContext } from '../action-contracts';
import { CURSOR_EXACT_START, CURSOR_START } from '../block-component';
import type { CstNode, ListItemMetadata } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import type { LineEnding } from '../core/lines';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { Reading } from '../schema/reading';
import type { MultiScopeTarget } from '../action-contracts';
import type { UndoController } from './deps';
import {
	replacePreservingFirst,
	stampStructuralChange,
	trackChildIds
} from '../tree-operations/structural-change';
import { spliceChildren } from '../tree-operations/children';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import { splitNode as performSplit, emptyParagraph } from '../tree-operations';
import { lastCaretLeaf } from '../selection/path-lookup';
import { ensureUnsharedChild } from '../tree-operations/unshare';
import {
	renumberOrderedList,
	normalizeItemMarkerToList,
	bumpOrderedMarker
} from '../tree-operations/list/ordered-markers';
import { buildListItem, buildListShell } from '../tree-operations/list/list-builders';
import { fragmentReaderAt } from '../tree-operations/list/task-paragraph';
import { buildExitReplacement } from '../tree-operations/list/exit-replacement';
import { settleSublistSeparator } from '../tree-operations/list/sublist-separator';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode } from '../reactivity/state-registry';
import type { NodeScope } from './nested/nested-actions';

export interface ListContextDeps {
	scope: NodeScope;
	/** The document's line ending, which the lines an item insert or a list exit creates take. */
	getLineEnding: () => LineEnding;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	parentListContext: ListContext | undefined;
	controller: UndoController;
	/** The editor's reading, for the mid-item split's reparse and marker rebalance. */
	reading: Reading;
}

/** The item Enter creates: the previous item's marker bumped, its task checkbox inherited
 *  unchecked. */
function mintFollowerItem(prevMeta: ListItemMetadata | undefined, children: CstNode[]): CstNode {
	const inheritTask = prevMeta?.taskItem === true;
	return buildListItem(
		{
			marker: bumpOrderedMarker(prevMeta?.marker ?? '- '),
			taskItem: inheritTask,
			taskChecked: false,
			taskMarker: inheritTask ? '[ ] ' : null
		},
		children
	);
}

export function createListContext(deps: ListContextDeps): ListContext {
	/** Item `index` of this list, at `offset`; a container position the landing resolves to a leaf. */
	const itemAt = (index: number, offset: number) => ({
		path: extendDocPath(deps.scope.path, index),
		offset
	});

	return {
		async indentItem(itemIndex: number): Promise<boolean> {
			const node = deps.scope.node;
			if (!node.children || itemIndex === 0) return false;

			const prevItem = node.children[itemIndex - 1];
			if (!prevItem.children) return false;

			const ordered = metadataOf(node, 'list').ordered;
			const existingNestedIdx = prevItem.children.findIndex(
				(c) => c.kind === 'list' && metadataOf(c, 'list').ordered === ordered
			);
			const existingNestedList =
				existingNestedIdx === -1 ? undefined : prevItem.children[existingNestedIdx];

			// One test, one destination: a matching sublist adopts the item whether or not it holds
			// any yet, so the scope list and the mutate branch cannot disagree about where it goes.
			const destination: MultiScopeTarget = existingNestedList
				? {
						node: existingNestedList,
						state: expectStateForNode(existingNestedList),
						path: [...deps.scope.path, itemIndex - 1, existingNestedIdx]
					}
				: {
						node: prevItem,
						state: expectStateForNode(prevItem),
						path: [...deps.scope.path, itemIndex - 1]
					};

			// The moved item's path below this list once it lands in the previous item.
			let movedTo: number[] = [];
			return deps.controller.commitMultiScope({
				scopes: [{ node, state: deps.state, path: deps.scope.path }, destination],
				snapshot: { path: extendDocPath(deps.scope.path, itemIndex), offset: 0 },
				mutate: ([outerScope, destScope]) => {
					const sharing = outerScope.sharing;
					const [movedItem] = outerScope.children.splice(itemIndex, 1);
					const at = destScope.children.length;
					movedTo = existingNestedList
						? [itemIndex - 1, existingNestedIdx, at]
						: [itemIndex - 1, at, 0];

					// Each branch renumbers the moved item's marker through `sharing`, which copies it first.
					if (existingNestedList) {
						const destList = destScope.node;
						destScope.children.push(movedItem);
						// Adopt the destination sublist's marker style, as a paste does. A fresh list
						// (the else branch) has no convention to adopt.
						const moved = ensureUnsharedChild(destList, destScope.children.length - 1, sharing);
						normalizeItemMarkerToList(moved, destList);
						renumberOrderedList(destList, 0, sharing);
					} else {
						const shell = buildListShell(ordered, [movedItem]);
						sharing.stamp(shell);
						destScope.children.push(shell);
						// Write, then read back (tree-operations/unshare.ts): the writes below go
						// through the value in the tree, not the list the proxy has observed.
						const destList = destScope.children[destScope.children.length - 1];
						renumberOrderedList(destList, 0, sharing);
						// A new sublist sits below the commit's chain, which never rebuilds it; the
						// blank-line rule below reads its bytes too.
						destScope.rebuild(destList);
						settleSublistSeparator(destScope.children, destScope.children.length - 1);
					}
					renumberOrderedList(outerScope.node, itemIndex, sharing);

					return [
						{ op: 'delete', at: itemIndex, count: 1 },
						{ op: 'insert', at: destScope.children.length - 1, count: 1 }
					];
				},
				op: {
					kind: 'replaceBlock',
					detail: { action: 'indentItem', itemIndex },
					eventPath: docPathFrom(deps.scope.path)
				},
				// The moved item's last leaf, at its start; the walk runs over this list's own items.
				landing: () => {
					const items: DocumentView = {
						kind: 'document',
						prefix: '',
						children: deps.scope.node.children ?? [],
						suffix: ''
					};
					const leaf = lastCaretLeaf(items, movedTo);
					return leaf && { path: docPathFrom([...deps.scope.path, ...leaf]), offset: CURSOR_START };
				}
			});
		},

		async unindentItem(itemIndex: number): Promise<boolean> {
			if (!deps.parentListContext || !deps.scope.node.children) return false;
			return deps.parentListContext.promoteNestedItem(
				deps.parentListContext.getContainingItemIndex(),
				deps.scope.node,
				itemIndex
			);
		},

		async insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<boolean> {
			const node = deps.scope.node;
			if (!node.children) return false;

			if (!newItem) {
				const prevItem = node.children[itemIndex];
				newItem = mintFollowerItem(
					prevItem ? metadataOf(prevItem, 'listItem') : undefined,
					// rebuildListItemRaw derives the item's raw from its body's line ending.
					[emptyParagraph('', deps.getLineEnding())]
				);
			}

			return deps.controller.commitMultiScope({
				scopes: [{ node, state: deps.state, path: deps.scope.path }],
				snapshot: { path: docPathFrom(deps.scope.path), offset: 0 },
				mutate: ([scope]) => {
					const sharing = scope.sharing;
					sharing.stamp(newItem!);
					scope.children.splice(itemIndex + 1, 0, newItem!);
					renumberOrderedList(scope.node, itemIndex + 1, sharing);
					return [{ op: 'insert', at: itemIndex + 1, count: 1 }];
				},
				op: {
					kind: 'appendBlock',
					detail: { itemIndex },
					eventPath: docPathFrom(deps.scope.path)
				},
				landing: () => itemAt(itemIndex + 1, 0)
			});
		},

		async splitItemAtOffset(
			itemIndex: number,
			innerIndex: number,
			offset: number
		): Promise<boolean> {
			const outerList = deps.scope.node;
			if (!outerList.children) return false;

			const item = outerList.children[itemIndex];
			if (!item.children) return false;

			const itemState = expectStateForNode(item);

			// Both lists in one commit, so mid-item Enter is a single undo entry.
			return deps.controller.commitMultiScope({
				scopes: [
					{ node: outerList, state: deps.state, path: deps.scope.path },
					{ node: item, state: itemState, path: [...deps.scope.path, itemIndex] }
				],
				// The real pre-edit caret: `offset` is inside the split leaf.
				snapshot: { path: docPathFrom([...deps.scope.path, itemIndex, innerIndex]), offset },
				mutate: ([outerScope, itemScope]) => {
					const sharing = outerScope.sharing;
					const itemChildren = itemScope.children;

					// The change must report everything removed from innerIndex onward, not just
					// the child that was split.
					const preSpliceLen = itemChildren.length;

					const split = performSplit(
						itemScope.body,
						innerIndex,
						offset,
						sharing,
						deps.reading,
						// The new item inherits this one's task marker, so its first block reads
						// as this item's first block does.
						fragmentReaderAt(itemScope.node, 0, deps.reading.grammar)
					);
					stampStructuralChange(itemChildren, split.change, sharing);
					// The primitive's index, not `innerIndex + 1`: a first half that parses to several
					// blocks stays with this item.
					const cutAt = split.secondHalfIndex;
					const secondHalf = itemChildren.splice(cutAt);
					if (secondHalf.length > 0) {
						secondHalf[0].leadingTrivia = '';
					}

					const newItem = mintFollowerItem(metadataOf(itemScope.node, 'listItem'), secondHalf);
					sharing.stamp(newItem);

					outerScope.children.splice(itemIndex + 1, 0, newItem);
					renumberOrderedList(outerScope.node, itemIndex + 1, sharing);

					// Net item change: [innerIndex .. preSpliceLen) replaced by the first half's
					// blocks, several when the cut bytes reparse to more than one.
					return [
						{ op: 'insert', at: itemIndex + 1, count: 1 },
						replacePreservingFirst(innerIndex, preSpliceLen - innerIndex, cutAt - innerIndex)
					];
				},
				op: {
					kind: 'split',
					detail: { at: offset, itemIndex, innerIndex },
					eventPath: docPathFrom(deps.scope.path)
				},
				landing: () => itemAt(itemIndex + 1, CURSOR_EXACT_START)
			});
		},

		async promoteNestedItem(
			parentItemIdx: number,
			nestedListNode: NodeView,
			nestedItemIdx: number
		): Promise<boolean> {
			const node = deps.scope.node;
			if (!node.children || !nestedListNode.children) return false;

			const parentItem = node.children[parentItemIdx];
			if (!parentItem?.children) return false;

			const nestedIdxInParent = parentItem.children.indexOf(nestedListNode);
			if (nestedIdxInParent === -1) return false;

			// The move can empty the nested list and then the parent item, so both are scopes.
			const scopes: MultiScopeTarget[] = [
				{ node, state: deps.state, path: deps.scope.path },
				{
					node: nestedListNode,
					state: expectStateForNode(nestedListNode),
					path: [...deps.scope.path, parentItemIdx, nestedIdxInParent]
				},
				{
					node: parentItem,
					state: expectStateForNode(parentItem),
					path: [...deps.scope.path, parentItemIdx]
				}
			];
			let promotedAt = parentItemIdx + 1;

			return deps.controller.commitMultiScope({
				scopes,
				// The promoted item's pre-move path (its nested-list slot).
				snapshot: {
					path: docPathFrom([...deps.scope.path, parentItemIdx, nestedIdxInParent, nestedItemIdx]),
					offset: 0
				},
				mutate: (scopeViews) => {
					const [outerScope, nestedScope] = scopeViews;
					const sharing = outerScope.sharing;
					// Opened before the move, since the cleanup below can splice any of the three lists.
					const ledgers = scopeViews.map((v) => trackChildIds(v.node));

					// The promoted item is moved and written (marker normalization, renumbering),
					// so copy it before it leaves the nested list.
					const item = ensureUnsharedChild(nestedScope.node, nestedItemIdx, sharing);
					spliceChildren(nestedScope.node, nestedItemIdx, 1, []);
					normalizeItemMarkerToList(item, outerScope.node);
					spliceChildren(outerScope.node, promotedAt, 0, [item]);

					// What the move emptied goes, up to this list, which now holds the promoted item.
					const outerCount = outerScope.children.length;
					cascadeCleanupEmptyAncestors(
						outerScope.node,
						[parentItemIdx, nestedIdxInParent, nestedItemIdx],
						sharing,
						deps.reading.grammar,
						outerScope.lineEnding
					);
					promotedAt -= outerCount - outerScope.children.length;

					if (nestedScope.children.length > 0) renumberOrderedList(nestedScope.node, 0, sharing);
					renumberOrderedList(outerScope.node, promotedAt, sharing);

					return ledgers.map((ledger) => {
						const change = ledger.read();
						ledger.release();
						return change;
					});
				},
				op: {
					kind: 'replaceBlock',
					detail: { action: 'promoteNestedItem', parentItemIdx, nestedItemIdx },
					eventPath: docPathFrom(deps.scope.path)
				},
				landing: () => itemAt(promotedAt, CURSOR_START)
			});
		},

		getContainingItemIndex(): number {
			// A top-level list; only nested lists return a meaningful value here.
			return -1;
		},

		async exitListAtItem(itemIndex: number): Promise<boolean> {
			const node = deps.scope.node;
			if (!node.children) return false;

			// In a nested list one Enter outdents one level, like Shift+Tab. Only the outermost
			// list exits straight to a paragraph.
			if (deps.parentListContext) {
				return deps.parentListContext.promoteNestedItem(
					deps.parentListContext.getContainingItemIndex(),
					node,
					itemIndex
				);
			}

			const replacement = buildExitReplacement(node, itemIndex, deps.getLineEnding());
			// The caret sat in an item, which an offset into the list can't name; the live read
			// records it.
			return deps.parentBlockEdit.replaceBlock(
				deps.scope.index,
				replacement.blocks,
				{ replacementIndex: replacement.paragraphIndex, offset: 0 },
				{ snapshotOffset: 0 }
			);
		}
	};
}
