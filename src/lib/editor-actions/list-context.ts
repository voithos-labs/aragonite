/**
 * Factory for the ListContext bundle that a ListBlock provides to its child
 * ListItemBlocks. All list-side structural mutations route through
 * `commitMultiScope`, whose owned scope views are the only legal write
 * targets — never the pre-commit `deps.scope.node` captures.
 */

import type { BlockEditActions, FocusActions, ListContext } from '../action-contracts';
import { FOCUS_LAST_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { MultiScopeTarget, UndoController } from './deps';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { splitNode as performSplit } from '../tree-operations';
import { ensureUnsharedChild } from '../tree-operations/unshare';
import { rebuildListRaw } from '../schema/container-rebuilders';
import {
	renumberOrderedList,
	normalizeItemMarkerToList,
	bumpOrderedMarker
} from '../tree-operations/list/ordered-markers';
import {
	buildListItem,
	buildListShell,
	readOrderedSuffix
} from '../tree-operations/list/list-builders';
import { buildExitReplacement } from '../tree-operations/list/exit-replacement';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { expectStateForNode } from '../reactivity/state-registry';
import type { NodeScope } from './nested/nested-actions';

export interface ListContextDeps {
	scope: NodeScope;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	parentListContext: ListContext | undefined;
	controller: UndoController;
}

export function createListContext(deps: ListContextDeps): ListContext {
	return {
		async indentItem(itemIndex: number): Promise<void> {
			const node = deps.scope.node;
			if (!node.children || itemIndex === 0) return;

			const prevItem = node.children[itemIndex - 1];
			if (!prevItem.children) return;

			const ordered = metadataOf(node, 'list').ordered;
			const existingNestedIdx = prevItem.children.findIndex(
				(c) => c.kind === 'list' && metadataOf(c, 'list').ordered === ordered
			);
			const existingNestedList =
				existingNestedIdx === -1 ? undefined : prevItem.children[existingNestedIdx];

			// Scope 0 = outer list (item removed).
			// Scope 1 = destination: existing same-kind nested list, or prevItem's
			//           children (where a new nested list will be appended).
			const scopes: MultiScopeTarget[] = [{ node, state: deps.state, path: deps.scope.path }];

			if (existingNestedList && existingNestedList.children) {
				scopes.push({
					node: existingNestedList,
					state: expectStateForNode(existingNestedList),
					path: [...deps.scope.path, itemIndex - 1, existingNestedIdx]
				});
			} else {
				scopes.push({
					node: prevItem,
					state: expectStateForNode(prevItem),
					path: [...deps.scope.path, itemIndex - 1]
				});
			}

			await deps.controller.commitMultiScope({
				scopes,
				snapshot: { path: extendDocPath(deps.scope.path, itemIndex), offset: 0 },
				mutate: ([outerScope, destScope]) => {
					const sharing = outerScope.sharing;
					const [movedItem] = outerScope.children.splice(itemIndex, 1);

					let destList: CstNode;
					if (existingNestedList) {
						destList = destScope.node;
						destScope.children.push(movedItem);
						// Adopt the destination sublist's marker style so the moved item
						// conforms to it (matching paste-absorb): the `. `/`) ` suffix within
						// the ordered axis, or the bullet glyph within the unordered axis.
						// Renumber (below) repaints an ordered number+raw on the canonical
						// handle. A fresh shell has no convention to adopt.
						const moved = ensureUnsharedChild(destList, destScope.children.length - 1, sharing);
						if (ordered) {
							const meta = metadataOf(moved, 'listItem');
							meta.marker = meta.marker.replace(/\D.*$/, '') + readOrderedSuffix(destList);
						} else {
							normalizeItemMarkerToList(moved, destList);
						}
					} else {
						destList = buildListShell(ordered, [movedItem]);
						sharing.stamp(destList);
						destScope.children.push(destList);
					}

					// Renumber writes the moved item's marker — sharing unshares it.
					renumberOrderedList(destList, 0, sharing);
					rebuildListRaw(destList);
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
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex - 1]?.focus(FOCUS_LAST_START);
				}
			});
		},

		async unindentItem(itemIndex: number): Promise<void> {
			if (!deps.parentListContext || !deps.scope.node.children) return;
			await deps.parentListContext.promoteNestedItem(
				deps.parentListContext.getContainingItemIndex(),
				deps.scope.node,
				itemIndex
			);
		},

		async insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<void> {
			const node = deps.scope.node;
			if (!node.children) return;

			if (!newItem) {
				const prevItem = node.children[itemIndex];
				const prevMeta = prevItem ? metadataOf(prevItem, 'listItem') : undefined;
				const prevMarker = prevMeta?.marker ?? '- ';
				const inheritTask = prevMeta?.taskItem === true;
				newItem = buildListItem(
					{
						marker: bumpOrderedMarker(prevMarker),
						taskItem: inheritTask,
						taskChecked: false,
						taskMarker: inheritTask ? '[ ] ' : null
					},
					[{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }]
				);
			}

			await deps.controller.commitMultiScope({
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
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex + 1]?.focus(0);
				}
			});
		},

		async splitItemAtOffset(itemIndex: number, innerIndex: number, offset: number): Promise<void> {
			const outerList = deps.scope.node;
			if (!outerList.children) return;

			const item = outerList.children[itemIndex];
			if (!item.children) return;

			const itemState = expectStateForNode(item);

			// Scope 0 = outer list (new sibling inserted).
			// Scope 1 = this item (content split, second half moves to sibling).
			// Combining both into one commit gives mid-item Enter a single undo entry.
			await deps.controller.commitMultiScope({
				scopes: [
					{ node: outerList, state: deps.state, path: deps.scope.path },
					{ node: item, state: itemState, path: [...deps.scope.path, itemIndex] }
				],
				// The true pre-edit caret: `offset` sits inside the split leaf.
				snapshot: { path: docPathFrom([...deps.scope.path, itemIndex, innerIndex]), offset },
				mutate: ([outerScope, itemScope]) => {
					const sharing = outerScope.sharing;
					const itemChildren = itemScope.children;

					// Pre-splice length — descriptor must report how many children
					// we actually removed from this scope (everything from innerIndex
					// onward), not just the one we split.
					const preSpliceLen = itemChildren.length;

					const splitChange = performSplit({ children: itemChildren }, innerIndex, offset);
					stampStructuralChange(itemChildren, splitChange, sharing);
					const secondHalf = itemChildren.splice(innerIndex + 1);
					if (secondHalf.length > 0) {
						secondHalf[0].leadingTrivia = '';
					}

					const prevMeta = metadataOf(itemScope.node, 'listItem');
					const inheritTask = prevMeta?.taskItem === true;
					const newItem = buildListItem(
						{
							marker: bumpOrderedMarker(prevMeta?.marker ?? '- '),
							taskItem: inheritTask,
							taskChecked: false,
							taskMarker: inheritTask ? '[ ] ' : null
						},
						secondHalf
					);
					sharing.stamp(newItem);

					outerScope.children.splice(itemIndex + 1, 0, newItem);
					renumberOrderedList(outerScope.node, itemIndex + 1, sharing);

					// Net scope-1 change: [innerIndex .. preSpliceLen) replaced by
					// the single first-half leaf.
					return [
						{ op: 'insert', at: itemIndex + 1, count: 1 },
						replacePreservingFirst(innerIndex, preSpliceLen - innerIndex, 1)
					];
				},
				op: {
					kind: 'split',
					detail: { at: offset, itemIndex, innerIndex },
					eventPath: docPathFrom(deps.scope.path)
				},
				afterTick: () => {
					deps.state.innerBlockRefs[itemIndex + 1]?.focus(0);
				}
			});
		},

		async promoteNestedItem(
			parentItemIdx: number,
			nestedListNode: NodeView,
			nestedItemIdx: number
		): Promise<void> {
			const node = deps.scope.node;
			if (!node.children || !nestedListNode.children) return;

			const parentItem = node.children[parentItemIdx];
			if (!parentItem?.children) return;

			const nestedIdxInParent = parentItem.children.indexOf(nestedListNode);
			if (nestedIdxInParent === -1) return;

			// Removing the last item empties the nested list, which needs a third
			// scope to splice the now-empty list out of parentItem's children.
			const nestedListWillEmpty = nestedListNode.children.length === 1;

			// Scope 0 = outer list (promoted item inserted).
			// Scope 1 = nested list (item spliced out).
			// Scope 2 (conditional) = parentItem (empty nested list removed).
			const scopes: MultiScopeTarget[] = [
				{ node, state: deps.state, path: deps.scope.path },
				{
					node: nestedListNode,
					state: expectStateForNode(nestedListNode),
					path: [...deps.scope.path, parentItemIdx, nestedIdxInParent]
				}
			];
			let parentItemScopeIdx = -1;
			if (nestedListWillEmpty) {
				parentItemScopeIdx = scopes.length;
				scopes.push({
					node: parentItem,
					state: expectStateForNode(parentItem),
					path: [...deps.scope.path, parentItemIdx]
				});
			}

			await deps.controller.commitMultiScope({
				scopes,
				// The promoted item's pre-move path (its nested-list slot).
				snapshot: {
					path: docPathFrom([...deps.scope.path, parentItemIdx, nestedIdxInParent, nestedItemIdx]),
					offset: 0
				},
				mutate: (scopeViews) => {
					const outerScope = scopeViews[0];
					const nestedScope = scopeViews[1];
					const sharing = outerScope.sharing;

					// The promoted item is moved AND written (marker normalization,
					// renumber) — own it before it leaves the nested list.
					const item = ensureUnsharedChild(nestedScope.node, nestedItemIdx, sharing);
					nestedScope.children.splice(nestedItemIdx, 1);

					const changes: StructuralChange[] = new Array(scopes.length);
					changes[1] = { op: 'delete', at: nestedItemIdx, count: 1 };

					if (nestedListWillEmpty && parentItemScopeIdx !== -1) {
						const parentItemChildren = scopeViews[parentItemScopeIdx].children;
						const nestedIdx = parentItemChildren.indexOf(nestedScope.node);
						if (nestedIdx !== -1) {
							parentItemChildren.splice(nestedIdx, 1);
							changes[parentItemScopeIdx] = { op: 'delete', at: nestedIdx, count: 1 };
						} else {
							changes[parentItemScopeIdx] = { op: 'noop' };
						}
					}

					if (!nestedListWillEmpty) {
						renumberOrderedList(nestedScope.node, 0, sharing);
					}

					normalizeItemMarkerToList(item, outerScope.node);
					// normalizeItemMarkerToList only reconciles the glyph (ordered ↔
					// unordered); adopt the destination's punctuation suffix (`. ` vs `) `)
					// too, matching paste-absorb. Renumber (below) repaints the number+raw.
					if (metadataOf(outerScope.node, 'list').ordered) {
						const meta = metadataOf(item, 'listItem');
						meta.marker = meta.marker.replace(/\D.*$/, '') + readOrderedSuffix(outerScope.node);
					}

					outerScope.children.splice(parentItemIdx + 1, 0, item);
					changes[0] = { op: 'insert', at: parentItemIdx + 1, count: 1 };

					renumberOrderedList(outerScope.node, parentItemIdx + 1, sharing);

					return changes;
				},
				op: {
					kind: 'replaceBlock',
					detail: { action: 'promoteNestedItem', parentItemIdx, nestedItemIdx },
					eventPath: docPathFrom(deps.scope.path)
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
			const node = deps.scope.node;
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
			await deps.parentBlockEdit.replaceBlock(deps.scope.index, replacement.blocks, {
				replacementIndex: replacement.paragraphIndex,
				offset: 0
			});
		}
	};
}
