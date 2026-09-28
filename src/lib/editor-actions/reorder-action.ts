/**
 * Moving a block among its siblings, for drag-and-drop and the keyboard nudge, as one commit.
 * A move can make two neighbours merge, so the caret and the announcement use the index the
 * reorder reports, not the destination the clamp picked.
 */

import { CURSOR_START } from '../block-component';
import { movedBlockToPosition } from '../a11y-strings';
import { reorderChildrenWithTrivia } from '../tree-operations/reorder';
import { resolveReorderUnit, type ReorderUnit } from '../tree-operations/reorder-unit';
import { blockNodeAt, documentBody, nodeAt } from '../tree-operations/node-primitives';
import { renumberOrderedList } from '../tree-operations/list/ordered-markers';
import { expectStateForNode } from '../reactivity/state-registry';
import { readCurrentSelection } from '../selection/native-bridge';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';
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
		const widgetCaret = deps.getSelectedWidgetCaret ?? (() => null);
		return (
			readCurrentSelection(deps.selectionState, deps.blockRefs, widgetCaret)?.focus.offset ?? 0
		);
	}

	function commitReorder(
		unit: ReorderUnit,
		to: number,
		offset: number,
		focusAfter: boolean
	): Promise<boolean> {
		let landing = to;

		if (unit.scope === 'document') {
			return controller.commitStructural({
				snapshot: { path: docPathFrom([unit.index]), offset },
				op: {
					kind: 'reorder',
					detail: { from: unit.index, to },
					eventPath: docPathFrom([unit.index])
				},
				mutate: (children) => {
					const settled = reorderChildrenWithTrivia(
						documentBody(deps.doc, children),
						unit.index,
						to,
						deps.sharing,
						deps.reading.grammar
					);
					landing = settled.landing;
					return settled.change;
				},
				afterTick: () => {
					if (focusAfter) deps.blockRefs[landing]?.focus(CURSOR_START);
				},
				announce: () => movedBlockToPosition(landing + 1, deps.doc.children.length)
			});
		}

		const parent = blockNodeAt(deps.doc, unit.parentPath);
		if (!parent) return Promise.resolve(false);
		const state = expectStateForNode(parent);
		return controller.commitContainerStructural({
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
					scope.body,
					unit.index,
					to,
					scope.sharing,
					deps.reading.grammar
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
			},
			// Re-resolved, not `parent`: the commit's copy-before-write replaced that node, so the
			// one resolved above still holds the pre-move children.
			announce: () =>
				movedBlockToPosition(
					landing + 1,
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
		// afterTick places the caret again when the caller wants it.
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
