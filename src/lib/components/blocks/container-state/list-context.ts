/**
 * Factory for the ListContext bundle that a ListBlock provides to its child
 * ListItemBlock components. Container-local wiring: it reaches into the list's
 * reactive BlockListState and calls through to the parent bundle, so it lives
 * under container-state/ alongside the state it depends on.
 *
 * Residual begin/end seam (0.5.4):
 * The following sites still use the legacy
 * `beginContainerEdit → state.commitChildrenEdit → endContainerEdit` seam
 * instead of routing through `commitContainerStructural`, so they do NOT emit
 * `edit` events on the `EditorEvents` surface. They DO get undo snapshots
 * (via begin) and reactivity publishes (via endContainerEdit's nudge).
 *
 * Known bypass sites:
 *   - indentItem (list-context.ts) — spans outer list + nested list state
 *   - unindentItem (list-context.ts) — delegates to promoteNestedItem
 *   - promoteNestedItem (list-context.ts) — spans outer + nested list state
 *   - ListItemBlock.svelte Enter (insertItemAfter path, lines ~135–138)
 *   - ListItemBlock.svelte Enter (splitItemAtOffset path, lines ~142–144)
 *   - blockquote-context.ts splitBlock exit path (lines ~48–54)
 *   - cross-block-dispatch.ts performCrossBlockDelete (pushes snapshots via
 *     mutCtx.pushUndoSnapshot, not through __commit — predates 0.5.4)
 *
 * Note: exitListAtItem is NOT on this seam — it routes through
 * parentBlockEdit.replaceBlock → commitStructural and DOES emit edit events.
 *
 * A multi-scope commit primitive is future work (0.5.5+).
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

			const ordered = (node.metadata as { ordered: boolean }).ordered;
			const existingNestedList = prevItem.children.find(
				(c) => c.kind === 'list' && (c.metadata as { ordered: boolean }).ordered === ordered
			);

			let movedItem!: CstNode;
			// TODO(0.5.5.3): migrate via multi-scope commit primitive
			deps.state.commitChildrenEdit((children, ids, refs) => {
				[movedItem] = children.splice(itemIndex, 1);
				ids.splice(itemIndex, 1);
				refs.splice(itemIndex, 1);
			});

			let destList: CstNode;
			if (existingNestedList && existingNestedList.children) {
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
				const prevItemState = getStateForNode(prevItem)!;
				prevItemState.commitChildrenEdit((children, ids, refs) => {
					children.push(destList);
					ids.push(generateBlockId());
					refs.push(undefined);
				});
			}

			renumberOrderedList(destList);
			rebuildListRaw(destList);
			rebuildListItemRaw(prevItem);
			renumberOrderedList(node, itemIndex);
			rebuildListRaw(node);
			deps.parentContainerEdit?.endContainerEdit();
			await tick();

			// FOCUS_LAST_START cascades through containers to the last child at offset 0.
			deps.state.innerBlockRefs[itemIndex - 1]?.focus(FOCUS_LAST_START);
		},

		async unindentItem(itemIndex: number): Promise<void> {
			if (!deps.parentListContext || !deps.node.children) return;
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

			// TODO(0.5.5.3): migrate via multi-scope commit primitive
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

			// 1. Remove item via the nested list's own state so ids/refs stay
			// aligned. If that empties the list, also remove it from parentItem.
			const nestedListState = getStateForNode(nestedListNode)!;
			// TODO(0.5.5.3): migrate via multi-scope commit primitive
			nestedListState.commitChildrenEdit((children, ids, refs) => {
				children.splice(nestedItemIdx, 1);
				ids.splice(nestedItemIdx, 1);
				refs.splice(nestedItemIdx, 1);
			});

			if (nestedListNode.children.length === 0) {
				const parentItemState = getStateForNode(parentItem)!;
				// TODO(0.5.5.3): migrate via multi-scope commit primitive
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

			// Normalize marker style before inserting so renumber can read a
			// well-formed marker suffix.
			normalizeItemMarkerToList(item, node);

			// TODO(0.5.5.3): migrate via multi-scope commit primitive
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
			return -1; // top-level list — only nested lists have a meaningful value here
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
