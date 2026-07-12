/**
 * ContainerEditActions factory — debounced checkpoint pusher for raw typing
 * mutations outside the commit primitive, the doc-root reactivity nudge, and
 * the unified `commitContainer` entry that routes structural mutations through
 * the commit primitive.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void {
			deps.stickyColumn.reset();
			controller.pushUndoSnapshotDebounced(leafPath, offset, batchKey);
		},

		nudgeReactivity(): void {
			// Out-of-commit-primitive raw mutations (cross-block typing, IME
			// composition entry, drag/clipboard sync mutate) surface through this
			// nudge so Svelte re-reads doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		withUnsharedSpine(absPath: number[], write: (chain: CstNode[]) => void): void {
			const chain = ensureUnsharedPath(deps.doc, absPath, deps.sharing);
			write(chain);
			rebuildUnsharedChain(chain, deps.sharing);
		},

		commitContainer(args): Promise<void> {
			return controller.commitContainerStructural(args);
		}
	};
}
