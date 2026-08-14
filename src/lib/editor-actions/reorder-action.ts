/**
 * Sibling-reorder action for the drag-and-drop and keyboard-nudge callers: resolve the unit a path
 * points into, clamp the destination, commit one permutation. A reorder creates no node — each
 * moved block keeps its id and ref through the `reorderChildren` idMap — and the only writes are
 * positional separators (`reorderChildrenWithTrivia`) and marker renumbering. Where the move
 * invalidated a join, that primitive's settle folds it, so both the caret and the announcement
 * ride the outcome it reports rather than the destination the clamp picked.
 */

import { CURSOR_START } from '../block-component';
import { reorderChildrenWithTrivia } from '../tree-operations/reorder';
import { resolveReorderUnit, type ReorderUnit } from '../tree-operations/reorder-unit';
import { blockNodeAt, nodeAt } from '../tree-operations/node-ops';
import { renumberOrderedList } from '../tree-operations/list/ordered-markers';
import { expectStateForNode } from '../reactivity/state-registry';
import { readCurrentSelection } from '../selection/native-bridge';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { EditorActionsDeps, UndoController } from './deps';

export interface ReorderAction {
	moveReorderUnit(fromPath: number[], toIndex: number): Promise<void>;
	nudgeReorderUnit(fromPath: number[], dir: -1 | 1): Promise<void>;
}

/** Where the move landed and how many siblings survive it, both read after the commit. */
interface ReorderOutcome {
	landing: number;
	total: number;
}

export function createReorderAction(
	deps: EditorActionsDeps,
	controller: UndoController,
	onReorder?: (to: number, total: number) => void
): ReorderAction {
	function caretOffset(): number {
		return readCurrentSelection(deps.selectionState, deps.blockRefs)?.focus.offset ?? 0;
	}

	async function commitReorder(
		unit: ReorderUnit,
		to: number,
		offset: number
	): Promise<ReorderOutcome | null> {
		let landing = to;

		if (unit.scope === 'document') {
			await controller.commitStructural({
				snapshot: { path: docPathFrom([unit.index]), offset },
				op: {
					kind: 'reorder',
					detail: { from: unit.index, to },
					eventPath: docPathFrom([unit.index])
				},
				mutate: (children) => {
					const settled = reorderChildrenWithTrivia(children, unit.index, to, deps.sharing);
					landing = settled.landing;
					return settled.change;
				},
				afterTick: () => deps.blockRefs[landing]?.focus(CURSOR_START)
			});
			return { landing, total: deps.doc.children.length };
		}

		const parent = blockNodeAt(deps.doc, unit.parentPath);
		if (!parent) return null;
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
				const settled = reorderChildrenWithTrivia(scope.children, unit.index, to, scope.sharing);
				landing = settled.landing;
				if (unit.renumberMarkers) {
					// Ordered markers are position-dependent, so this unshares each item whose
					// marker it rewrites; the ceremony's rebuild then concatenates fresh raws.
					renumberOrderedList(scope.node, 0, scope.sharing);
				}
				return settled.change;
			},
			afterTick: () => state.innerBlockRefs[landing]?.focus(CURSOR_START)
		});
		return { landing, total: parent.children?.length ?? 0 };
	}

	function resolveAndClamp(
		fromPath: number[],
		computeTo: (currentIndex: number) => number
	): { unit: ReorderUnit; to: number } | null {
		const unit = resolveReorderUnit(deps.doc, fromPath);
		if (!unit) return null;
		const parent = unit.scope === 'document' ? deps.doc : nodeAt(deps.doc, unit.parentPath);
		const total = parent?.children?.length ?? 0;
		const to = Math.max(0, Math.min(computeTo(unit.index), total - 1));
		if (to === unit.index) return null;
		return { unit, to };
	}

	async function run(
		fromPath: number[],
		computeTo: (currentIndex: number) => number
	): Promise<void> {
		const target = resolveAndClamp(fromPath, computeTo);
		if (!target) return;
		// Drop any cross-block selection so the overlay doesn't fight the move; the
		// commit's afterTick re-places the caret.
		deps.selectionState.collapse();
		const outcome = await commitReorder(target.unit, target.to, caretOffset());
		if (outcome) onReorder?.(outcome.landing, outcome.total);
	}

	return {
		moveReorderUnit: (fromPath, toIndex) => run(fromPath, () => toIndex),
		nudgeReorderUnit: (fromPath, dir) => run(fromPath, (index) => index + dir)
	};
}
