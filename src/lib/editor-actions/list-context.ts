/**
 * Factory for the ListContext bundle that a ListBlock provides to its child
 * ListItemBlocks. All list-side structural mutations route through
 * `commitMultiScope`.
 */

import type { CstNode, ListItemMetadata } from '../core/nodes';
import {
	FOCUS_LAST_START,
	type BlockEditActions,
	type FocusActions,
	type ListContext
} from '../contracts';
import type { MultiScopeTarget, UndoController } from './deps';
import type { StructuralChange } from '../tree-operations/structural-change';
import { splitNode as performSplit } from '../tree-operations';
import { rebuildListRaw, rebuildListItemRaw } from '../schema/container-raw';
import {
	renumberOrderedList,
	normalizeItemMarkerToList
} from '../tree-operations/list/ordered-markers';
import { buildExitReplacement } from '../tree-operations/list/exit-replacement';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode } from '../reactivity/state-registry';

export interface ListContextDeps {
	get index(): number;
	get node(): CstNode;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
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

			// Scope 0 = outer list (item removed).
			// Scope 1 = destination: existing same-kind nested list, or prevItem's
			//           children (where a new nested list will be appended).
			const scopes: MultiScopeTarget[] = [{ node, state: deps.state }];

			if (existingNestedList && existingNestedList.children) {
				scopes.push({ node: existingNestedList, state: expectStateForNode(existingNestedList) });
			} else {
				scopes.push({ node: prevItem, state: expectStateForNode(prevItem) });
			}

			let destList: CstNode | null = null;
			if (existingNestedList) {
				destList = existingNestedList;
			}

			await deps.controller.commitMultiScope({
				scopes,
				snapshot: { blockIndex: deps.index, offset: 0 },
				mutate: (scopeChildren) => {
					const [outerScope, destScope] = scopeChildren;

					const [movedItem] = outerScope.children.splice(itemIndex, 1);

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

					// Sync before rebuild — rebuild helpers read node.children directly.
					node.children = outerScope.children;
					if (existingNestedList) {
						existingNestedList.children = destScope.children;
					} else {
						prevItem.children = destScope.children;
					}

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
				op: {
					kind: 'replaceBlock',
					detail: { action: 'indentItem', itemIndex },
					eventPath: [deps.index]
				},
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex - 1]?.focus(FOCUS_LAST_START);
				}
			});
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
				const prevMeta = node.children[itemIndex]?.metadata as ListItemMetadata | undefined;
				const prevMarker = prevMeta?.marker ?? '- ';
				const marker = prevMarker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
				const inheritTask = prevMeta?.taskItem === true;
				newItem = {
					kind: 'listItem',
					leadingTrivia: '',
					raw: '',
					metadata: {
						marker,
						taskItem: inheritTask,
						taskChecked: false,
						taskMarker: inheritTask ? '[ ] ' : null
					},
					innerPrefix: '',
					children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
					innerSuffix: ''
				};
				rebuildListItemRaw(newItem);
			}

			await deps.controller.commitMultiScope({
				scopes: [{ node, state: deps.state }],
				snapshot: { blockIndex: deps.index, offset: 0 },
				mutate: (scopeChildren) => {
					scopeChildren[0].children.splice(itemIndex + 1, 0, newItem!);
					// Sync before rebuild — rebuildListRaw reads node.children directly.
					node.children = scopeChildren[0].children;
					renumberOrderedList(node, itemIndex + 1);
					rebuildListRaw(node);
					return [{ op: 'insert', at: itemIndex + 1, count: 1 }];
				},
				op: {
					kind: 'appendBlock',
					detail: { itemIndex },
					eventPath: [deps.index]
				},
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex + 1]?.focus(0);
				}
			});
		},

		async splitItemAtOffset(itemIndex: number, innerIndex: number, offset: number): Promise<void> {
			const outerList = deps.node;
			if (!outerList.children) return;

			const item = outerList.children[itemIndex];
			if (!item.children) return;

			const itemState = expectStateForNode(item);

			// Scope 0 = outer list (new sibling inserted).
			// Scope 1 = this item (content split, second half moves to sibling).
			// Combining both into one commit gives mid-item Enter a single undo entry.
			await deps.controller.commitMultiScope({
				scopes: [
					{ node: outerList, state: deps.state },
					{ node: item, state: itemState }
				],
				snapshot: { blockIndex: deps.index, offset },
				mutate: (scopeChildren) => {
					const outerChildren = scopeChildren[0].children;
					const itemChildren = scopeChildren[1].children;

					// Pre-splice length — descriptor must report how many children
					// we actually removed from this scope (everything from innerIndex
					// onward), not just the one we split.
					const preSpliceLen = itemChildren.length;

					performSplit({ children: itemChildren }, innerIndex, offset);
					const secondHalf = itemChildren.splice(innerIndex + 1);
					if (secondHalf.length > 0) {
						secondHalf[0].leadingTrivia = '';
					}

					const prevMarker = (item.metadata as { marker?: string })?.marker ?? '- ';
					const newMarker = prevMarker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
					const newItem: CstNode = {
						kind: 'listItem',
						leadingTrivia: '',
						raw: '',
						metadata: {
							marker: newMarker,
							taskItem: (item.metadata as { taskItem?: boolean }).taskItem ?? false,
							taskChecked: false,
							taskMarker: null
						},
						innerPrefix: '',
						children: secondHalf,
						innerSuffix: ''
					};

					// Sync before rebuild for both scopes.
					item.children = itemChildren;
					rebuildListItemRaw(item);
					rebuildListItemRaw(newItem);

					outerChildren.splice(itemIndex + 1, 0, newItem);
					outerList.children = outerChildren;
					renumberOrderedList(outerList, itemIndex + 1);
					rebuildListRaw(outerList);

					// Net scope-1 change: [innerIndex .. preSpliceLen) replaced by
					// the single first-half leaf. idMap preserves the split leaf's id.
					return [
						{ op: 'insert', at: itemIndex + 1, count: 1 },
						{
							op: 'replace',
							at: innerIndex,
							count: preSpliceLen - innerIndex,
							newCount: 1,
							idMap: { 0: 0 }
						} as StructuralChange
					];
				},
				op: { kind: 'split', detail: { itemIndex, innerIndex, offset }, eventPath: [deps.index] },
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex + 1]?.focus(0);
				}
			});
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
			// Removing the last item empties the nested list, which needs a third
			// scope to splice the now-empty list out of parentItem's children.
			const nestedListWillEmpty = nestedListNode.children.length === 1;

			// Scope 0 = outer list (promoted item inserted).
			// Scope 1 = nested list (item spliced out).
			// Scope 2 (conditional) = parentItem (empty nested list removed).
			const scopes: MultiScopeTarget[] = [
				{ node, state: deps.state },
				{ node: nestedListNode, state: expectStateForNode(nestedListNode) }
			];
			let parentItemScopeIdx = -1;
			if (nestedListWillEmpty) {
				parentItemScopeIdx = scopes.length;
				scopes.push({ node: parentItem, state: expectStateForNode(parentItem) });
			}

			await deps.controller.commitMultiScope({
				scopes,
				snapshot: { blockIndex: deps.index, offset: 0 },
				mutate: (scopeChildren) => {
					const outerChildren = scopeChildren[0].children;
					const nestedChildren = scopeChildren[1].children;

					nestedChildren.splice(nestedItemIdx, 1);

					const changes: StructuralChange[] = new Array(scopes.length);
					changes[1] = { op: 'delete', at: nestedItemIdx, count: 1 };

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

					// Sync before rebuild — rebuild helpers read node.children directly.
					nestedListNode.children = nestedChildren;
					if (nestedListWillEmpty && parentItemScopeIdx !== -1) {
						parentItem.children = scopeChildren[parentItemScopeIdx].children;
					}

					if (!nestedListWillEmpty) {
						renumberOrderedList(nestedListNode);
						rebuildListRaw(nestedListNode);
					}
					rebuildListItemRaw(parentItem);

					normalizeItemMarkerToList(item, node);

					outerChildren.splice(parentItemIdx + 1, 0, item);
					changes[0] = { op: 'insert', at: parentItemIdx + 1, count: 1 };

					node.children = outerChildren;
					renumberOrderedList(node, parentItemIdx + 1);
					rebuildListRaw(node);

					return changes;
				},
				op: {
					kind: 'replaceBlock',
					detail: { action: 'promoteNestedItem', parentItemIdx, nestedItemIdx },
					eventPath: [deps.index]
				},
				afterTick: () => {
					deps.state.innerBlockRefs[parentItemIdx + 1]?.focus(0);
				}
			});
		},

		getContainingItemIndex(): number {
			// Top-level list — only nested lists return a meaningful value here.
			return -1;
		},

		async exitListAtItem(itemIndex: number): Promise<void> {
			const node = deps.node;
			if (!node.children) return;

			// Nested list: one Enter outdents one level (Shift+Tab semantics), matching
			// Backspace-on-first-child-of-nested-list in ListBlock. Only the outermost
			// list escapes straight to a paragraph.
			if (deps.parentListContext) {
				await deps.parentListContext.promoteNestedItem(
					deps.parentListContext.getContainingItemIndex(),
					node,
					itemIndex
				);
				return;
			}

			const replacement = buildExitReplacement(node, itemIndex);
			await deps.parentBlockEdit.replaceBlock(deps.index, replacement.blocks, {
				replacementIndex: replacement.paragraphIndex,
				offset: 0
			});
		}
	};
}
