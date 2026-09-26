/**
 * The root ContainerEditActions: the debounced undo checkpoint for typing outside a commit,
 * the document-root reactivity nudge, the leaf write path, and `commitContainer`.
 */

import type { ContainerEditActions } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import { documentLineEnding, type LineEnding } from '../core/lines';
import type { SharingState } from '../tree-operations/sharing';
import { ensureUnsharedPath } from '../tree-operations/unshare';
import { rebuildUnsharedChain, type AncestrySeamFold } from '../tree-operations/chain-rebuild';
import type { StructuralChange } from '../tree-operations/structural-change';
import { publishAncestryFolds, publishScopeFold } from './ancestry-folds';
import { admitsWrite } from './commit/reading-write-gate';
import type { EditorActionsDeps, UndoController } from './deps';

export function createContainerEditActions(
	deps: EditorActionsDeps,
	controller: UndoController
): ContainerEditActions {
	return {
		pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void {
			deps.caretMemory.forget();
			controller.pushUndoSnapshotDebounced(leafPath, offset, batchKey);
		},

		armDebouncedPause(): void {
			controller.armUndoPause();
		},

		lineEnding(): LineEnding {
			return documentLineEnding(deps.doc);
		},

		nudgeReactivity(): void {
			// Raw writes made outside a commit become visible through this nudge, which makes
			// Svelte re-read doc.children.
			deps.doc.children = [...deps.doc.children];
		},

		withUnsharedSpine(
			absPath: number[],
			write: (chain: CstNode[], sharing: SharingState) => StructuralChange | void
		): boolean {
			if (!admitsWrite(deps.reading, 'updateContent')) return false;
			const chain = ensureUnsharedPath(deps.doc, absPath, deps.sharing);
			// Read before the write: no level of the rebuild can recover the leaf's old bytes
			// itself, and the ancestor fix-up needs them to locate the leaf's region.
			const leafPreviousRaw = chain[chain.length - 1]?.raw;
			const written = write(chain, deps.sharing) ?? { op: 'noop' };
			// Unconditional: this path exists to write bytes, and a short chain or a `noop`
			// change says nothing about whether `write` changed any.
			deps.bumpContentVersion();
			// The write's own fix-up can splice the child list it wrote in, and a short chain means
			// the copy never reached that list, so there is nothing to write to state.
			if (chain.length === absPath.length) {
				publishScopeFold(deps, chain[absPath.length - 2], written);
			}
			// Containers that collapsed into their parent during the rebuild. Nothing rolls back
			// outside a commit, so their undo function is dropped, and no caret is placed after them.
			const folds: AncestrySeamFold[] = [];
			const replacements = rebuildUnsharedChain(
				deps.doc,
				chain,
				deps.sharing,
				folds,
				deps.reading.grammar,
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
