/**
 * Factory for the ListContext bundle that a ListBlock provides to its child
 * ListItemBlock components. Container-local wiring: it reaches into the list's
 * reactive BlockListState and calls through to the parent bundle, so it lives
 * under container-state/ alongside the state it depends on.
 */

import { tick } from 'svelte';
import type { CstNode } from '../../../core/nodes';
import {
	FOCUS_LAST_START,
	type BlockEditActions,
	type FocusActions,
	type ContainerEditActions,
	type ListContext
} from '../../../contracts';
import { generateBlockId } from '../../../tree-operations/block-id';
import { rebuildListRaw, rebuildListItemRaw } from '../../../tree-operations/container-raw';
import {
	renumberOrderedList,
	normalizeItemMarkerToList,
	buildExitReplacement
} from '../../../tree-operations/list-ops';
import type { BlockListState } from './block-list-state.svelte';
import { getStateForNode } from './state-registry';

export interface ListContextDeps {
	/** Reactive getter for the list container's own index in its parent. */
	get index(): number;
	/** Reactive getter for the list CstNode. */
	get node(): CstNode;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	parentContainerEdit: ContainerEditActions | undefined;
	parentListContext: ListContext | undefined;
}

export function createListContext(deps: ListContextDeps): ListContext {
	return {
		async indentItem(itemIndex: number): Promise<void> {
			const node = deps.node;
			if (!node.children || itemIndex === 0) return;

			const prevItem = node.children[itemIndex - 1];
			if (!prevItem.children) return;

			deps.parentContainerEdit?.beginContainerEdit(deps.index, 0);

			// Pre-compute the destination list (existing nested list of the
			// matching type, or a new one to append).
			const ordered = (node.metadata as { ordered: boolean }).ordered;
			const existingNestedList = prevItem.children.find(
				(c) => c.kind === 'list' && (c.metadata as { ordered: boolean }).ordered === ordered
			);

			// Atomic splice of children/ids/refs via commitChildrenEdit. We
			// take ownership of the item from the outer list FIRST so we have
			// a clean reference, then append it to the destination list
			// inside prevItem (which is still shared with the committed
			// children array — prevItem is the same object either way).
			let movedItem!: CstNode;
			deps.state.commitChildrenEdit((children, ids, refs) => {
				[movedItem] = children.splice(itemIndex, 1);
				ids.splice(itemIndex, 1);
				refs.splice(itemIndex, 1);
			});

			let destList: CstNode;
			if (existingNestedList && existingNestedList.children) {
				// existingNestedList is a currently-mounted list inside prevItem;
				// its ListBlock registered a BlockListState on mount.
				const existingState = getStateForNode(existingNestedList)!;
				existingState.commitChildrenEdit((children, ids, refs) => {
					children.push(movedItem);
					ids.push(generateBlockId());
					refs.push(undefined);
				});
				destList = existingNestedList;
			} else {
				destList = {
					kind: 'list',
					leadingTrivia: '',
					raw: '',
					metadata: { ordered },
					children: [movedItem]
				};
				// prevItem is a currently-mounted list item; its ListItemBlock
				// registered a BlockListState on mount.
				const prevItemState = getStateForNode(prevItem)!;
				prevItemState.commitChildrenEdit((children, ids, refs) => {
					children.push(destList);
					ids.push(generateBlockId());
					refs.push(undefined);
				});
			}

			// Renumber the destination list (so the appended item slots into the
			// right position in the sequence) and the now-shrunk parent list.
			renumberOrderedList(destList);
			rebuildListRaw(destList);
			rebuildListItemRaw(prevItem);
			renumberOrderedList(node, itemIndex);
			rebuildListRaw(node);
			deps.parentContainerEdit?.endContainerEdit();
			deps.state.triggerReactivity();
			await tick();

			// Focus the indented item — it's now the last child of the previous
			// item's nested list. FOCUS_LAST_START cascades through containers
			// choosing the last child at each level, placing cursor at offset 0.
			deps.state.innerBlockRefs[itemIndex - 1]?.focus(FOCUS_LAST_START);
		},

		async unindentItem(itemIndex: number): Promise<void> {
			if (!deps.parentListContext || !deps.node.children) return;
			// Delegate the full operation to the parent list, which has direct
			// access to its own children array and the parent item node.
			await deps.parentListContext.promoteNestedItem(
				deps.parentListContext.getContainingItemIndex(),
				deps.node,
				itemIndex
			);
		},

		async insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<void> {
			const node = deps.node;
			if (!node.children) return;

			if (!newItem) {
				const prevMarker =
					(node.children[itemIndex]?.metadata as { marker?: string })?.marker ?? '- ';
				// For ordered lists, increment the number (e.g. "1. " → "2. ")
				const marker = prevMarker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
				newItem = {
					kind: 'listItem',
					leadingTrivia: '',
					raw: '',
					metadata: { marker, taskItem: false, taskChecked: false },
					innerPrefix: '',
					children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
					innerSuffix: ''
				};
				rebuildListItemRaw(newItem);
			}

			// Atomic splice of children/ids/refs via commitChildrenEdit so
			// that bind:this doesn't leave a stale ref at the shifted index.
			deps.state.commitChildrenEdit((children, ids, refs) => {
				children.splice(itemIndex + 1, 0, newItem!);
				ids.splice(itemIndex + 1, 0, generateBlockId());
				refs.splice(itemIndex + 1, 0, undefined);
			});
			renumberOrderedList(node, itemIndex + 1);
			rebuildListRaw(node);
			await tick();
			deps.state.innerBlockRefs[itemIndex + 1]?.focus(0);
		},

		async promoteNestedItem(
			parentItemIdx: number,
			nestedListNode: CstNode,
			nestedItemIdx: number
		): Promise<void> {
			const node = deps.node;
			if (!node.children || !nestedListNode.children) return;

			const parentItem = node.children[parentItemIdx];
			if (!parentItem?.children) return;

			deps.parentContainerEdit?.beginContainerEdit(deps.index, 0);

			const item = nestedListNode.children[nestedItemIdx];

			// 1. Remove item from nested list through the nested list's own
			// state, so its ids/refs stay aligned with its mounted children.
			// If the nested list is now empty, remove it from parentItem
			// through parentItem's state so parentItem's ids/refs likewise
			// stay aligned. Both nodes are currently mounted containers —
			// their BlockListState is registered.
			const nestedListState = getStateForNode(nestedListNode)!;
			nestedListState.commitChildrenEdit((children, ids, refs) => {
				children.splice(nestedItemIdx, 1);
				ids.splice(nestedItemIdx, 1);
				refs.splice(nestedItemIdx, 1);
			});

			if (nestedListNode.children.length === 0) {
				const parentItemState = getStateForNode(parentItem)!;
				parentItemState.commitChildrenEdit((children, ids, refs) => {
					const nestedIdx = children.indexOf(nestedListNode);
					if (nestedIdx !== -1) {
						children.splice(nestedIdx, 1);
						ids.splice(nestedIdx, 1);
						refs.splice(nestedIdx, 1);
					}
				});
			} else {
				renumberOrderedList(nestedListNode);
				rebuildListRaw(nestedListNode);
			}
			rebuildListItemRaw(parentItem);

			// 2. Normalize the promoted item's marker style to this list's type
			// (ordered ↔ unordered) before inserting, so the subsequent renumber
			// pass can read a well-formed marker suffix.
			normalizeItemMarkerToList(item, node);

			// 3. Insert into the outer list via atomic commitChildrenEdit so
			// children/ids/refs stay aligned (prevents stale trailing refs).
			deps.state.commitChildrenEdit((children, ids, refs) => {
				children.splice(parentItemIdx + 1, 0, item);
				ids.splice(parentItemIdx + 1, 0, generateBlockId());
				refs.splice(parentItemIdx + 1, 0, undefined);
			});
			renumberOrderedList(node, parentItemIdx + 1);
			rebuildListRaw(node);

			deps.parentContainerEdit?.endContainerEdit();
			await tick();
			deps.state.innerBlockRefs[parentItemIdx + 1]?.focus(0);
		},

		getContainingItemIndex(): number {
			return -1; // top-level list; never read because unindentItem guards on parentListContext.
		},

		async exitListAtItem(itemIndex: number): Promise<void> {
			const node = deps.node;
			if (!node.children) return;

			const replacement = buildExitReplacement(node, itemIndex);
			await deps.parentBlockEdit.replaceBlock(deps.index, replacement.blocks, {
				replacementIndex: replacement.paragraphIndex,
				offset: 0
			});
		}
	};
}
