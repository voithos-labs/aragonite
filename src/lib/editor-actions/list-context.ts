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
	stampStructuralChange
} from '../tree-operations/structural-change';
import { splitNode as performSplit, emptyParagraph } from '../tree-operations';
import { lastCaretLeaf } from '../selection/path-lookup';
import { renumberOrderedList, bumpOrderedMarker } from '../tree-operations/list/ordered-markers';
import { buildListItem } from '../tree-operations/list/list-builders';
import { fragmentReaderAt } from '../tree-operations/list/task-paragraph';
import { buildExitReplacement } from '../tree-operations/list/exit-replacement';
import {
	nestListItem,
	liftNestedItem,
	type ItemMoveCommits
} from '../tree-operations/list/item-moves';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode, getStateForNode } from '../reactivity/state-registry';
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
 *  unchecked; it starts from `source`'s bytes, so its marker line takes the item's indent. */
function mintFollowerItem(
	prevMeta: ListItemMetadata | undefined,
	children: CstNode[],
	source?: NodeView
): CstNode {
	const inheritTask = prevMeta?.taskItem === true;
	return buildListItem(
		{
			marker: bumpOrderedMarker(prevMeta?.marker ?? '- '),
			taskItem: inheritTask,
			taskChecked: false,
			taskMarker: inheritTask ? '[ ] ' : null
		},
		children,
		source
	);
}

export function createListContext(deps: ListContextDeps): ListContext {
	/** Item `index` of this list, at `offset`; a container position the landing resolves to a leaf. */
	const itemAt = (index: number, offset: number) => ({
		path: extendDocPath(deps.scope.path, index),
		offset
	});

	const itemMoves: ItemMoveCommits = {
		commitMultiScope: (args) => deps.controller.commitMultiScope(args),
		resolveState: getStateForNode
	};
	const ownScope = (): MultiScopeTarget => ({
		node: deps.scope.node,
		state: deps.state,
		path: deps.scope.path
	});

	return {
		indentItem(itemIndex: number): Promise<boolean> {
			// The moved item's last leaf, at its start; the walk runs over this list's own items.
			return nestListItem(itemMoves, ownScope(), itemIndex, (movedTo) => {
				const items: DocumentView = {
					kind: 'document',
					prefix: '',
					children: deps.scope.node.children ?? [],
					suffix: ''
				};
				const leaf = lastCaretLeaf(items, movedTo);
				return leaf && { path: docPathFrom([...deps.scope.path, ...leaf]), offset: CURSOR_START };
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
					[emptyParagraph('', deps.getLineEnding())],
					prevItem
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

					const newItem = mintFollowerItem(
						metadataOf(itemScope.node, 'listItem'),
						secondHalf,
						itemScope.node
					);
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

		promoteNestedItem(
			parentItemIdx: number,
			nestedListNode: NodeView,
			nestedItemIdx: number
		): Promise<boolean> {
			return liftNestedItem(
				itemMoves,
				ownScope(),
				parentItemIdx,
				nestedListNode,
				nestedItemIdx,
				deps.reading.grammar,
				(promotedAt) => itemAt(promotedAt, CURSOR_START)
			);
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
