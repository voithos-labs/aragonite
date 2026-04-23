/**
 * ContainerEditActions factory — checkpoint pushers for paths that mutate
 * raw outside the commit primitive, the doc-root reactivity nudge, and the
 * unified `commitContainer` entry that routes structural mutations through
 * the commit primitive.
 */

import type { ContainerEditActions } from '../../contracts';
import type { OperationKind } from '../../debug/operations-log';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushCheckpoint(blockIndex: number, offset: number): void {
			deps.stickyColumn.reset();
			controller.clearDebouncedCheckpoint();
			controller.pushUndoSnapshot(blockIndex, offset);
		},

		pushDebouncedCheckpoint(
			blockIndex: number,
			offset: number,
			batchKey?: string | number
		): void {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(blockIndex, offset, batchKey);
		},

		nudgeReactivity(): void {
			// Out-of-commit-primitive raw mutations (cross-block typing, IME
			// composition entry, drag/clipboard sync mutate) surface through this
			// nudge so Svelte re-reads doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		commitContainer(containerNode, state, snapshot, mutate, afterTick, op): Promise<void> {
			return controller.commitContainerStructural(
				containerNode,
				state,
				snapshot,
				mutate,
				afterTick,
				// Public interface widens to `string` for ergonomics; OperationKind
				// is the internal source of truth.
				op
					? {
							kind: op.kind as OperationKind,
							detail: op.detail,
							eventPath: op.eventPath
						}
					: undefined
			);
		}
	};
}
