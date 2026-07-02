/**
 * Container BlockEditActions factory. Interior split/merge/delete/replace/
 * metadata route through the shared `block-edit-core` against a container
 * `CommitScope`; this wrapper adds the container-only concerns the core can't
 * own: the `if (!deps.node.children) return` guards, boundary delegation
 * (edge merges/deletes hand UP to `parent.blockEdit`), the unwrap dispatch
 * (first/middle-child backspace strategies), `insertParsedBlocks` (routes
 * through `replaceBlock` — G2.9 dual-emit), and `updateBlockContent`.
 */

import type { BlockEditActions } from '../../action-contracts';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import {
	updateNodeContent as performUpdate,
	ensureUnsharedChild,
	reconcileTaskMetadata,
	foldPasteReplacement
} from '../../tree-operations';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { assertInvariant } from '../../invariants/assert';
import { CURSOR_END } from '../../block-component';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { createBlockEditCore } from '../block-edit-core';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { parent } = deps;
	const scope = createContainerScope(state, deps);
	const core = createBlockEditCore(scope);

	const blockEdit: BlockEditActions = {
		// ── Structural mutations (interior → core, edges → parent) ─────────────
		async splitBlock(innerIndex, offset) {
			if (!deps.node.children) return;
			await core.split(innerIndex, offset);
		},

		async descendToBody(innerIndex) {
			if (!deps.node.children) return;
			await core.descendToBody(innerIndex);
		},

		async mergeWithPrevious(innerIndex) {
			if (!deps.node.children) return;

			const unwrapRole = tryGetBlockKindDescriptor(deps.node.kind)?.unwrapRole;

			if (innerIndex <= 0) {
				if (unwrapRole) {
					await firstChildUnwrapStrategies[unwrapRole.firstChildBackspace]({ deps, state });
					return;
				}
				// Undeclared containers delegate upward (listItem children land here).
				// Await so caller continuations (focus placement) run after the
				// upward chain settles.
				await parent.blockEdit.mergeWithPrevious(deps.index);
				return;
			}

			if (unwrapRole && unwrapRole.middleChildBackspace !== 'default-merge') {
				await middleChildUnwrapStrategies[unwrapRole.middleChildBackspace](
					{ deps, state },
					innerIndex
				);
				return;
			}

			await core.mergeWithPreviousInterior(innerIndex);
		},

		async mergeWithNext(innerIndex) {
			if (!deps.node.children) return;

			if (innerIndex >= deps.node.children.length - 1) {
				return parent.blockEdit.mergeWithNext(deps.index);
			}

			await core.mergeWithNextInterior(innerIndex);
		},

		async deleteBlock(innerIndex) {
			if (!deps.node.children) return;

			if (deps.node.children.length <= 1) {
				return parent.blockEdit.deleteBlock(deps.index);
			}

			await core.deleteInterior(innerIndex);
		},

		updateBlockMetadata: (innerIndex, metadata, options) =>
			core.updateBlockMetadata(innerIndex, metadata, options),

		replaceBlock: (innerIndex, replacement, focus, options) =>
			core.replaceBlock(innerIndex, replacement, focus, options),

		// ── Paste (container routes through replaceBlock — G2.9 dual-emit) ─────
		async insertParsedBlocks(innerIndex, offset, blocks, preDelete, options) {
			if (!deps.node.children || blocks.length === 0) return;
			if (innerIndex < 0 || innerIndex >= deps.node.children.length) return;

			const replacement = foldPasteReplacement(
				deps.node.children[innerIndex],
				offset,
				blocks,
				preDelete
			);
			await core.replaceBlock(
				innerIndex,
				replacement,
				{ replacementIndex: replacement.length - 1, offset: CURSOR_END },
				options
			);
		},

		// ── In-place leaf edits (per-level; unification deferred) ──────────────
		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			if (!deps.node.children) return;

			// Preview on a shallow clone of the target child — the only node
			// performUpdate reads — to pick between structural (kind-changing)
			// commit and routine typing path. Live tree is not mutated here —
			// the chosen branch runs the real mutation below.
			const preview = performUpdate({ children: [{ ...deps.node.children[innerIndex] }] }, 0, text);

			if (preview.op !== 'noop') {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					path: deps.path,
					state,
					snapshot: { blockIndex: deps.index, offset: preEditOffset ?? 0 },
					mutate: (scope) => {
						ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
						return performUpdate({ children: scope.children }, innerIndex, text);
					},
					op: {
						kind: 'updateContent',
						detail: { length: text.length },
						eventPath: [deps.index, innerIndex]
					},
					afterTick: () => {
						state.innerBlockRefs[innerIndex]?.focus(focusOffset);
					}
				});
				return;
			}

			// Routine typing — debounced undo path, no structural commit. Pass
			// the inner leaf's id as the batch key so focus moves between
			// sibling leaves inside this container break the typing batch.
			parent.containerEdit.pushDebouncedCheckpoint(
				deps.index,
				preEditOffset ?? 0,
				state.innerBlockIds[innerIndex]
			);
			const leafPath = [...deps.path, innerIndex];
			parent.containerEdit.withUnsharedSpine(leafPath, (chain) => {
				assertInvariant('unshared-spine-depth', () =>
					chain.length === leafPath.length
						? null
						: {
								code: 'unshared-spine-depth',
								message: `withUnsharedSpine: chain depth ${chain.length} != leaf path depth ${leafPath.length}`
							}
				);
				const ownedContainer = chain[leafPath.length - 2];
				if (!ownedContainer?.children) return;
				performUpdate({ children: ownedContainer.children }, innerIndex, text);
				// listItem's taskItem metadata is extracted at parse time from the
				// first stripped line; live typing into the inner paragraph would
				// otherwise leave metadata frozen while serialized source drifts.
				if (ownedContainer.kind === 'listItem' && innerIndex === 0) {
					reconcileTaskMetadata(ownedContainer);
				}
			});
			parent.containerEdit.nudgeReactivity();
		}
	};

	return blockEdit;
}
