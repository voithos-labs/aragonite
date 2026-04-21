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
 *   - ListItemBlock.svelte Enter (insertItemAfter path, lines ~135–138)
 *   - ListItemBlock.svelte Enter (splitItemAtOffset path, lines ~142–144)
 *   - blockquote-context.ts splitBlock exit path (lines ~48–54)
 *   - cross-block-dispatch.ts performCrossBlockDelete (pushes snapshots via
 *     mutCtx.pushUndoSnapshot, not through __commit — predates 0.5.4)
 *
 * Note: exitListAtItem is NOT on this seam — it routes through
 * parentBlockEdit.replaceBlock → commitStructural and DOES emit edit events.
 *
 * indentItem and promoteNestedItem were migrated to commitMultiScope (0.5.5.3)
 * and now emit exactly one edit event per call.
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
import type { MultiScopeTarget, UndoController } from '../../editor-actions/deps';
import type { StructuralChange } from '../../../tree-operations/structural-change';
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
	controller: UndoController;
}

export function createListContext(deps: ListContextDeps): ListContext {
	return {
		async indentItem(itemIndex: number): Promise<void> {
			const node = deps.node;
			if (!node.children || itemIndex === 0) return;

			const prevItem = node.children[itemIndex - 1];
			if (!prevItem.children) return;

			const ordered = (node.metadata as { ordered: boolean }).ordered;
			const existingNestedList = prevItem.children.find(
				(c) => c.kind === 'list' && (c.metadata as { ordered: boolean }).ordered === ordered
			);

			// Build the scope array. Outermost scope first.
			// Scope 0 = outer list (deps.node / deps.state) — item is removed here.
			// Scope 1 = destination: existing same-kind nested list OR prevItem's
			//           children (where a new nested list will be appended).
			const scopes: MultiScopeTarget[] = [{ node, state: deps.state }];

			if (existingNestedList && existingNestedList.children) {
				scopes.push({ node: existingNestedList, state: getStateForNode(existingNestedList)! });
			} else {
				scopes.push({ node: prevItem, state: getStateForNode(prevItem)! });
			}

			let destList: CstNode | null = null;
			if (existingNestedList) {
				destList = existingNestedList;
			}

			await deps.controller.commitMultiScope(
				scopes,
				{ blockIndex: deps.index, offset: 0 },
				(scopeChildren) => {
					const [outerScope, destScope] = scopeChildren;

					// Scope 0: remove the item being indented.
					const [movedItem] = outerScope.children.splice(itemIndex, 1);

					// Scope 1: push moved item into existing nested list, or build a
					// new nested list and push it into prevItem's children.
					if (existingNestedList) {
						destScope.children.push(movedItem);
					} else {
						destList = {
							kind: 'list',
							leadingTrivia: '',
							raw: '',
							metadata: { ordered },
							children: [movedItem]
						};
						destScope.children.push(destList);
					}

					// Write scope copies back to nodes before raw rebuild — rebuildListRaw
					// and rebuildListItemRaw read node.children directly.
					node.children = outerScope.children;
					if (existingNestedList) {
						existingNestedList.children = destScope.children;
					} else {
						prevItem.children = destScope.children;
					}

					// Raw rebuilds. destList points to the nested list (existing or new).
					if (destList) {
						renumberOrderedList(destList);
						rebuildListRaw(destList);
					}
					rebuildListItemRaw(prevItem);
					renumberOrderedList(node, itemIndex);
					rebuildListRaw(node);

					return [
						{ op: 'delete', at: itemIndex, count: 1 },
						{ op: 'insert', at: destScope.children.length - 1, count: 1 }
					];
				},
				{
					kind: 'replaceBlock',
					detail: { action: 'indentItem', itemIndex },
					eventPath: [deps.index]
				}
			);

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

			const item = nestedListNode.children[nestedItemIdx];
			// When the nested list has exactly one item, removing it empties the
			// list — we need a third scope to splice out the now-empty list node
			// from parentItem's children.
			const nestedListWillEmpty = nestedListNode.children.length === 1;

			// Scope list. The outermost container goes first so commitMultiScope
			// applies the doc-level reactivity nudge from that scope's perspective.
			// Scope 0 = outer list (deps.node / deps.state) — promoted item inserted here.
			// Scope 1 = nested list — item spliced out here.
			// Scope 2 (conditional) = parentItem's children — empty nested list removed.
			const scopes: MultiScopeTarget[] = [
				{ node, state: deps.state },
				{ node: nestedListNode, state: getStateForNode(nestedListNode)! }
			];
			let parentItemScopeIdx = -1;
			if (nestedListWillEmpty) {
				parentItemScopeIdx = scopes.length;
				scopes.push({ node: parentItem, state: getStateForNode(parentItem)! });
			}

			await deps.controller.commitMultiScope(
				scopes,
				{ blockIndex: deps.index, offset: 0 },
				(scopeChildren) => {
					const outerChildren = scopeChildren[0].children;
					const nestedChildren = scopeChildren[1].children;

					// Scope 1: remove item from the nested list.
					nestedChildren.splice(nestedItemIdx, 1);

					const changes: StructuralChange[] = new Array(scopes.length);
					changes[1] = { op: 'delete', at: nestedItemIdx, count: 1 };

					// Scope 2: remove the now-empty nested list from parentItem's children.
					if (nestedListWillEmpty && parentItemScopeIdx !== -1) {
						const parentItemChildren = scopeChildren[parentItemScopeIdx].children;
						const nestedIdx = parentItemChildren.indexOf(nestedListNode);
						if (nestedIdx !== -1) {
							parentItemChildren.splice(nestedIdx, 1);
							changes[parentItemScopeIdx] = { op: 'delete', at: nestedIdx, count: 1 };
						} else {
							changes[parentItemScopeIdx] = { op: 'noop' };
						}
					}

					// Write scope copies back to nodes before raw rebuild — rebuild
					// helpers read node.children directly, not the scope copies.
					nestedListNode.children = nestedChildren;
					if (nestedListWillEmpty && parentItemScopeIdx !== -1) {
						parentItem.children = scopeChildren[parentItemScopeIdx].children;
					}

					// Raw rebuilds for the nested list (only when it remains non-empty).
					if (!nestedListWillEmpty) {
						renumberOrderedList(nestedListNode);
						rebuildListRaw(nestedListNode);
					}
					rebuildListItemRaw(parentItem);

					// Normalize marker style to match the outer list before inserting.
					normalizeItemMarkerToList(item, node);

					// Scope 0: insert the promoted item after parentItemIdx in the outer list.
					outerChildren.splice(parentItemIdx + 1, 0, item);
					changes[0] = { op: 'insert', at: parentItemIdx + 1, count: 1 };

					// Write outer copy back before rebuilding.
					node.children = outerChildren;
					renumberOrderedList(node, parentItemIdx + 1);
					rebuildListRaw(node);

					return changes;
				},
				{
					kind: 'replaceBlock',
					detail: { action: 'promoteNestedItem', parentItemIdx, nestedItemIdx },
					eventPath: [deps.index]
				}
			);

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
