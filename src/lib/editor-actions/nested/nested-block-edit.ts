/**
 * Container BlockEditActions factory. Interior split/merge/delete/replace/
 * metadata route through the shared `block-edit-core` against a container
 * `CommitScope`; this wrapper adds the container-only concerns the core can't
 * own: the `if (!deps.node.children) return` guards, boundary delegation
 * (edge merges/deletes hand UP to `parent.blockEdit`), the unwrap dispatch
 * (first/middle-child backspace strategies), and `updateBlockContent`.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../../action-contracts';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import {
	updateNodeContent as performUpdate,
	ensureUnsharedChild,
	reconcileTaskMetadata
} from '../../tree-operations';
import {
	stampStructuralChange,
	type StructuralChange
} from '../../tree-operations/structural-change';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { assertInvariant } from '../../invariants/assert';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { createBlockEditCore } from '../block-edit-core';
import { previewContentReparse, focusAfterContentReplace } from '../replacement-focus';
import { extendDocPath } from '../../cursor/coordinate-spaces';

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

			// A collapsed container's body children are unmounted, so the chrome row is
			// the last VISIBLE child. Forward-Delete exits past the container rather than
			// merging into (or dead-ending on) the invisible body — an I-1-consistent
			// focus move, no mutation (mirrors gateMoveFocusOnCollapse). `append: false`
			// keeps the last-block case inert: without it, exiting past the final block
			// mints a trailing paragraph (root focus append path), mutating on a Delete.
			if (isCollapsedContainer(deps.node)) {
				await parent.focus.moveFocus(deps.index + 1, 'start', { append: false });
				return;
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

		// ── In-place leaf edits (per-level) ────────────────────────────────────
		mapCommittedOffset(text, offset) {
			const bodyWrite = tryGetBlockKindDescriptor(deps.node.kind)?.bodyWrite;
			return bodyWrite ? bodyWrite.mapOffset(text, offset) : offset;
		},

		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			if (!deps.node.children) return;

			const preview = previewContentReparse(
				deps.node.children[innerIndex],
				text,
				deps.grammar,
				deps.node.kind
			);

			const leafPath = extendDocPath(deps.path, innerIndex);

			if (preview.op !== 'noop') {
				const focusOffset = postEditFocusOffset ?? preEditOffset ?? 0;
				let change: StructuralChange = { op: 'noop' };
				await parent.containerEdit.commitContainer({
					containerNode: deps.node,
					path: deps.path,
					state,
					snapshot: { path: leafPath, offset: preEditOffset ?? 0 },
					mutate: (scope) => {
						ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
						change = performUpdate(
							{ children: scope.children, ownerKind: scope.node.kind },
							innerIndex,
							text,
							deps.grammar
						);
						stampStructuralChange(scope.children, change, scope.sharing);
						return change;
					},
					op: {
						kind: 'updateContent',
						detail: { length: text.length },
						eventPath: leafPath
					},
					afterTick: () =>
						focusAfterContentReplace(deps.path, innerIndex, change, focusOffset, scope)
				});
				return;
			}

			// Routine typing — debounced undo path, no structural commit. Pass
			// the inner leaf's id as the batch key so focus moves between
			// sibling leaves inside this container break the typing batch.
			parent.containerEdit.pushDebouncedCheckpoint(
				leafPath,
				preEditOffset ?? 0,
				state.innerBlockIds[innerIndex]
			);
			const reclassified = parent.containerEdit.withUnsharedSpine(leafPath, (chain) => {
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
				performUpdate(
					{ children: ownedContainer.children, ownerKind: ownedContainer.kind },
					innerIndex,
					text,
					deps.grammar
				);
				// listItem's taskItem metadata is extracted at parse time from the
				// first stripped line; live typing into the inner paragraph would
				// otherwise leave metadata frozen while serialized source drifts.
				if (ownedContainer.kind === 'listItem' && innerIndex === 0) {
					reconcileTaskMetadata(ownedContainer);
				}
			});
			parent.containerEdit.nudgeReactivity();
			// The rebuild re-kinded a container on this spine (the typed `> [!TIP]`
			// marker moved out of the leaf and into the container's own bytes), so the
			// edited leaf no longer exists. Re-enter the container at its start; its
			// focus walk lands in the body, where the marker line never was.
			if (reclassified) {
				await tick();
				await parent.focus.moveFocus(deps.index, 'start');
			}
		}
	};

	return blockEdit;
}
