/**
 * Sibling-reorder action for the drag-and-drop and keyboard-nudge callers.
 * Resolves the reorderable unit a path points into, clamps the destination,
 * and commits one permutation of the parent's children — document scope through
 * `commitStructural`, list/blockquote scope through `commitContainerStructural`.
 *
 * A reorder creates no node: each moved block keeps its id + ref via the
 * `reorderChildren` idMap (no stamp, no destroy/recreate). The only writes are
 * positional separators (`leadingTrivia` stays with the slot, not the node —
 * see `reorderChildrenWithTrivia`), ordered-list marker renumbering, and the
 * container's raw rebuild, all of which the commit's scope view owns.
 */

import { reorderChildrenWithTrivia } from '../tree-operations/reorder';
import { resolveReorderUnit, type ReorderUnit } from '../tree-operations/reorder-unit';
import { blockNodeAt, nodeAt } from '../tree-operations/node-ops';
import { renumberOrderedList } from '../tree-operations/list/ordered-markers';
import { rebuildListRaw, rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { expectStateForNode } from '../reactivity/state-registry';
import { readCurrentSelection } from '../selection/native-bridge';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { EditorActionsDeps, UndoController } from './deps';

export interface ReorderAction {
	moveReorderUnit(fromPath: number[], toIndex: number): Promise<void>;
	nudgeReorderUnit(fromPath: number[], dir: -1 | 1): Promise<void>;
}

export function createReorderAction(
	deps: EditorActionsDeps,
	controller: UndoController,
	onReorder?: (to: number, total: number) => void
): ReorderAction {
	function caretOffset(): number {
		return readCurrentSelection(deps.selectionState, deps.blockRefs)?.focus.offset ?? 0;
	}

	async function commitReorder(unit: ReorderUnit, to: number, offset: number): Promise<void> {
		if (unit.parentKind === 'document') {
			await controller.commitStructural({
				snapshot: { path: docPathFrom([unit.index]), offset },
				op: {
					kind: 'reorder',
					detail: { from: unit.index, to },
					eventPath: docPathFrom([unit.index])
				},
				mutate: (children) => reorderChildrenWithTrivia(children, unit.index, to, deps.sharing),
				afterTick: () => deps.blockRefs[to]?.focus(0)
			});
			return;
		}

		const parent = blockNodeAt(deps.doc, unit.parentPath);
		if (!parent) return;
		const state = expectStateForNode(parent);
		await controller.commitContainerStructural({
			containerNode: parent,
			path: unit.parentPath,
			state,
			// A drag carries no live caret: restore to the moved unit's pre-move path.
			snapshot: { path: extendDocPath(unit.parentPath, unit.index), offset },
			op: {
				kind: 'reorder',
				detail: { from: unit.index, to },
				eventPath: docPathFrom(unit.parentPath)
			},
			mutate: (scope) => {
				const change = reorderChildrenWithTrivia(scope.children, unit.index, to, scope.sharing);
				if (unit.parentKind === 'list') {
					// No-op on unordered lists; on ordered lists it unshares each item
					// whose marker it rewrites (scope.sharing) before the rebuild.
					renumberOrderedList(scope.node, 0, scope.sharing);
					rebuildListRaw(scope.node);
				} else {
					rebuildBlockquoteRaw(scope.node);
				}
				return change;
			},
			afterTick: () => state.innerBlockRefs[to]?.focus(0)
		});
	}

	function resolveAndClamp(
		fromPath: number[],
		computeTo: (currentIndex: number) => number
	): { unit: ReorderUnit; to: number; total: number } | null {
		const unit = resolveReorderUnit(deps.doc, fromPath);
		if (!unit) return null;
		const parent = unit.parentKind === 'document' ? deps.doc : nodeAt(deps.doc, unit.parentPath);
		const total = parent?.children?.length ?? 0;
		const to = Math.max(0, Math.min(computeTo(unit.index), total - 1));
		if (to === unit.index) return null;
		return { unit, to, total };
	}

	async function run(
		fromPath: number[],
		computeTo: (currentIndex: number) => number
	): Promise<void> {
		const target = resolveAndClamp(fromPath, computeTo);
		if (!target) return;
		// Drop any cross-block selection so the overlay doesn't fight the move; the
		// commit's afterTick re-places the caret in the moved block.
		deps.selectionState.collapse();
		await commitReorder(target.unit, target.to, caretOffset());
		onReorder?.(target.to, target.total);
	}

	return {
		moveReorderUnit: (fromPath, toIndex) => run(fromPath, () => toIndex),
		nudgeReorderUnit: (fromPath, dir) => run(fromPath, (index) => index + dir)
	};
}
