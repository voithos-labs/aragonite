/**
 * Moving a block among its siblings, for drag-and-drop and the keyboard nudge: resolve the
 * unit a path points into, clamp the destination, commit one permutation. A reorder creates no
 * node (each moved block keeps its id and ref through the `reorderChildren` idMap); the only
 * writes are blank-line separators and marker renumbering. A move can make two neighbours
 * merge, so the caret and the announcement use the outcome the primitive reports, not the
 * destination the clamp picked.
 */

import { CURSOR_START } from '../block-component';
import type { CommandId } from '../schema/commands';
import { reorderChildrenWithTrivia } from '../tree-operations/reorder';
import { resolveReorderUnit, type ReorderUnit } from '../tree-operations/reorder-unit';
import { blockNodeAt, nodeAt } from '../tree-operations/node-primitives';
import { renumberOrderedList } from '../tree-operations/list/ordered-markers';
import { expectStateForNode } from '../reactivity/state-registry';
import { readCurrentSelection } from '../selection/native-bridge';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
import type { EditorActionsDeps, UndoController } from './deps';

export interface ReorderAction {
	moveReorderUnit(fromPath: number[], toIndex: number): Promise<void>;
	nudgeReorderUnit(fromPath: number[], dir: -1 | 1): Promise<void>;
}

/** The two command ids that mean a reorder nudge, handled once for every block's `runCommand`. */
export function reorderRunCommand(
	id: CommandId,
	reorder: Pick<ReorderAction, 'nudgeReorderUnit'>,
	getPath: () => number[]
): boolean {
	if (id !== 'block.moveUp' && id !== 'block.moveDown') return false;
	void reorder.nudgeReorderUnit(getPath(), id === 'block.moveUp' ? -1 : 1);
	return true;
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
		offset: number,
		focusAfter: boolean
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
					const settled = reorderChildrenWithTrivia(
						children,
						unit.index,
						to,
						deps.sharing,
						deps.grammar,
						true
					);
					landing = settled.landing;
					return settled.change;
				},
				afterTick: () => {
					if (focusAfter) deps.blockRefs[landing]?.focus(CURSOR_START);
				}
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
			// A drag carries no live caret, so undo restores to the moved unit's pre-move path.
			snapshot: { path: extendDocPath(unit.parentPath, unit.index), offset },
			op: {
				kind: 'reorder',
				detail: { from: unit.index, to },
				eventPath: docPathFrom(unit.parentPath)
			},
			mutate: (scope) => {
				const settled = reorderChildrenWithTrivia(
					scope.children,
					unit.index,
					to,
					scope.sharing,
					deps.grammar
				);
				landing = settled.landing;
				if (unit.renumberMarkers) {
					// Ordered markers depend on position, so this copies each item whose marker it
					// rewrites; the commit's rebuild then concatenates the fresh raws.
					renumberOrderedList(scope.node, 0, scope.sharing);
				}
				return settled.change;
			},
			afterTick: () => {
				if (focusAfter) state.innerBlockRefs[landing]?.focus(CURSOR_START);
			}
		});
		// Re-resolved, not `parent`: the commit's copy-before-write replaced that node, so the
		// one resolved above still holds the pre-move children.
		return { landing, total: blockNodeAt(deps.doc, unit.parentPath)?.children?.length ?? 0 };
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
		computeTo: (currentIndex: number) => number,
		focusAfter: boolean
	): Promise<void> {
		const target = resolveAndClamp(fromPath, computeTo);
		if (!target) return;
		// Drop any cross-block selection so the overlay does not fight the move; the commit's
		// afterTick places the caret again when the caller wants it.
		deps.selectionState.collapse();
		const outcome = await commitReorder(target.unit, target.to, caretOffset(), focusAfter);
		if (outcome) onReorder?.(outcome.landing, outcome.total);
	}

	return {
		// A dropped block is not a block the user asked to edit: focusing it opens whatever a
		// caret opens there (an equation shows its source), which a drag did not ask for. The
		// keyboard nudge is the opposite: the caret must move with the block.
		moveReorderUnit: (fromPath, toIndex) => run(fromPath, () => toIndex, false),
		nudgeReorderUnit: (fromPath, dir) => run(fromPath, (index) => index + dir, true)
	};
}
