/**
 * Moving a block among its siblings, for drag-and-drop and the keyboard nudge, as one commit.
 * A move can make two neighbours merge, so the caret and the announcement use the index the
 * reorder reports, not the destination the clamp picked.
 */

import { CURSOR_START } from '../block-component';
import { movedBlockToPosition } from '../a11y-strings';
import { reorderChildrenWithTrivia } from '../tree-operations/reorder';
import type { FixedUpEdit } from '../tree-operations/fix-up/apply';
import { resolveReorderUnit, type ReorderUnit } from '../tree-operations/reorder-unit';
import { blockNodeAt, documentBody, nodeAt } from '../tree-operations/node-primitives';
import { orderedBaseOf, renumberOrderedListFrom } from '../tree-operations/list/ordered-markers';
import { getStateForNode } from '../block-lists/state-registry';
import { containerScopeState } from '../tree-operations/paste/parent-scope';
import { readCurrentSelection } from '../selection/native-bridge';
import { extendDocPath, docPathFrom } from '../core/coordinate-spaces';
import type { EditorActionsDeps, UndoController } from './deps';

/** Each move resolves to whether it landed. */
export interface ReorderAction {
	moveReorderUnit(fromPath: number[], toIndex: number): Promise<boolean>;
	nudgeReorderUnit(fromPath: number[], dir: -1 | 1): Promise<boolean>;
}

export function createReorderAction(
	deps: EditorActionsDeps,
	controller: UndoController
): ReorderAction {
	function caretOffset(): number {
		return readCurrentSelection(deps.selectionState, deps.blockRefs)?.focus.offset ?? 0;
	}

	function commitReorder(
		unit: ReorderUnit,
		to: number,
		offset: number,
		focusAfter: boolean
	): Promise<boolean> {
		let landedAt = to;
		let settled = (): FixedUpEdit | null => null;
		// Where the moved block stands once the commit's fix-up merged anything around it.
		const movedTo = () => settled()?.moved ?? landedAt;
		// The caret moves with the block, so a block moved off screen scrolls back into view.
		const landing = (parentPath: readonly number[]) => () =>
			focusAfter ? { path: extendDocPath(parentPath, movedTo()), offset: CURSOR_START } : null;

		if (unit.scope === 'document') {
			return controller.commitStructural({
				snapshot: { path: docPathFrom([unit.index]), offset },
				op: {
					kind: 'reorder',
					detail: { from: unit.index, to },
					eventPath: docPathFrom([unit.index])
				},
				mutate: (children, docScope) => {
					const moved = reorderChildrenWithTrivia(
						documentBody(deps.doc, children),
						unit.index,
						to,
						deps.sharing
					);
					landedAt = moved.landing;
					settled = docScope.describeEdit({
						moved: { to: landedAt, uncovered: moved.uncovered }
					});
					return moved.change;
				},
				landing: landing([]),
				announce: () => movedBlockToPosition(movedTo() + 1, deps.doc.children.length)
			});
		}

		const parent = blockNodeAt(deps.doc, unit.parentPath);
		if (!parent) return Promise.resolve(false);
		return controller.commitContainerStructural({
			containerNode: parent,
			path: unit.parentPath,
			// A drop can land after autoscroll carried the parent's mounted part out of the window.
			state: containerScopeState({ resolveState: getStateForNode }, parent),
			// A drag carries no live caret, so undo restores to the moved unit's pre-move path.
			snapshot: { path: extendDocPath(unit.parentPath, unit.index), offset },
			op: {
				kind: 'reorder',
				detail: { from: unit.index, to },
				eventPath: docPathFrom(unit.parentPath)
			},
			mutate: (scope) => {
				// Read before the move, which can take the first item and its number elsewhere.
				const start = orderedBaseOf(scope.node.children?.[0]);
				const moved = reorderChildrenWithTrivia(scope.body, unit.index, to, scope.sharing);
				landedAt = moved.landing;
				settled = scope.describeEdit({ moved: { to: landedAt, uncovered: moved.uncovered } });
				// Only an ordered list renumbers; any other container keeps its children as moved.
				renumberOrderedListFrom(scope.node, start, scope.sharing);
				return moved.change;
			},
			landing: landing(unit.parentPath),
			// Re-resolved, not `parent`: the commit's copy-before-write replaced that node, so the
			// one resolved above still holds the pre-move children.
			announce: () =>
				movedBlockToPosition(
					movedTo() + 1,
					blockNodeAt(deps.doc, unit.parentPath)?.children?.length ?? 0
				)
		});
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
	): Promise<boolean> {
		const target = resolveAndClamp(fromPath, computeTo);
		if (!target) return false;
		// Drop any cross-block selection so the overlay does not fight the move; the commit's
		// landing places the caret again when the caller wants it.
		deps.selectionState.collapse();
		return commitReorder(target.unit, target.to, caretOffset(), focusAfter);
	}

	return {
		// A drop leaves the caret out, since focusing a block opens whatever a caret opens there (an
		// equation's source); the keyboard nudge moves the caret with the block.
		moveReorderUnit: (fromPath, toIndex) => run(fromPath, () => toIndex, false),
		nudgeReorderUnit: (fromPath, dir) => run(fromPath, (index) => index + dir, true)
	};
}
