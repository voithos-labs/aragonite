/**
 * ContainerEditActions factory: the debounced checkpoint pusher for raw typing
 * outside the commit primitive, the doc-root reactivity nudge, and `commitContainer`.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { SharingState } from '../tree-operations/sharing';
import {
	ensureUnsharedPath,
	rebuildUnsharedChain,
	type AncestrySeamFold
} from '../tree-operations/unshare';
import type { StructuralChange } from '../tree-operations/structural-change';
import { dropChildSpans } from '../schema/child-spans';
import { publishAncestryFolds, publishScopeFold } from './ancestry-folds';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void {
			deps.stickyColumn.reset();
			deps.edgeAffinity.reset();
			controller.pushUndoSnapshotDebounced(leafPath, offset, batchKey);
		},

		armDebouncedPause(): void {
			controller.armUndoPause();
		},

		nudgeReactivity(): void {
			// Raw mutations made outside the commit primitive surface through this nudge,
			// so Svelte re-reads doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		withUnsharedSpine(
			absPath: number[],
			write: (chain: CstNode[], sharing: SharingState) => StructuralChange | void
		): boolean {
			const chain = ensureUnsharedPath(deps.doc, absPath, deps.sharing);
			// Read before the write: it is the one byte-state no level of the rebuild can capture
			// for itself, and the ancestry splice needs it to place the leaf's own region.
			const leafPreviousRaw = chain[chain.length - 1]?.raw;
			const written = write(chain, deps.sharing) ?? { op: 'noop' };
			// Unconditional: this door exists to carry bytes, and a short chain or a `noop`
			// settle says nothing about whether `write` moved any.
			deps.bumpContentVersion();
			// The write's own settle can splice the scope it wrote in, and a short chain means the
			// unshare never reached that scope, so there is nothing to publish against.
			if (chain.length === absPath.length) {
				const scope = chain[absPath.length - 2];
				// A settle inside the write re-tiled the scope, so the spans naming its children's
				// regions describe a shape that is gone.
				if (scope && written.op !== 'noop') dropChildSpans(scope);
				publishScopeFold(deps, scope, written);
			}
			// The ANCESTRY settle's folds — a container's own slot in its PARENT, not the write's
			// scope published above. Their unwind is discarded on purpose: nothing rolls back at a
			// door that is not a ceremony. Their caret landing (`foldLandingFor`) wants a tick this
			// synchronous door has not got, and no producer reaches one.
			const folds: AncestrySeamFold[] = [];
			const replacements = rebuildUnsharedChain(
				deps.doc,
				chain,
				deps.sharing,
				folds,
				deps.grammar,
				leafPreviousRaw === undefined ? undefined : { path: absPath, leafPreviousRaw }
			);
			publishAncestryFolds(deps, folds);
			return replacements.length > 0;
		},

		commitContainer(args): Promise<void> {
			return controller.commitContainerStructural(args);
		}
	};
}
