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
	focusTargetInReplacement,
	ensureUnsharedChild,
	reconcileTaskMetadata,
	foldPasteReplacement
} from '../../tree-operations';
import {
	stampStructuralChange,
	type StructuralChange
} from '../../tree-operations/structural-change';
import { pastedContentFocusIndex } from '../../tree-operations/paste/hooks';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { assertInvariant } from '../../invariants/assert';
import { CURSOR_END } from '../../block-component';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { createBlockEditCore } from '../block-edit-core';
import { focusMovedOutsideReplacement } from '../replacement-focus';

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

		// ── Paste (container routes through replaceBlock — G2.9 dual-emit) ─────
		async insertParsedBlocks(innerIndex, offset, blocks, preDelete, options) {
			if (!deps.node.children || blocks.length === 0) return;
			if (innerIndex < 0 || innerIndex >= deps.node.children.length) return;

			const target = deps.node.children[innerIndex];
			const replacement = foldPasteReplacement(target, offset, blocks, preDelete);
			await core.replaceBlock(
				innerIndex,
				replacement,
				{
					replacementIndex: pastedContentFocusIndex(target, offset, preDelete, replacement.length),
					offset: CURSOR_END
				},
				options
			);
		},

		// ── In-place leaf edits (per-level) ────────────────────────────────────
		async updateBlockContent(
			innerIndex: number,
			text: string,
			preEditOffset?: number,
			postEditFocusOffset?: number
		): Promise<void> {
			if (!deps.node.children) return;

			// Preview on a minimal probe (kind + raw are all performUpdate reads)
			// to pick between structural (kind-changing) commit and routine typing
			// path. Live tree is not mutated here — the chosen branch runs the
			// real mutation below.
			const child = deps.node.children[innerIndex];
			const probe = { kind: child.kind, leadingTrivia: child.leadingTrivia, raw: child.raw };
			const preview = performUpdate({ children: [probe] }, 0, text);

			const leafPath = [...deps.path, innerIndex];

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
						change = performUpdate({ children: scope.children }, innerIndex, text);
						stampStructuralChange(scope.children, change, scope.sharing);
						return change;
					},
					op: {
						kind: 'updateContent',
						detail: { length: text.length },
						eventPath: leafPath
					},
					afterTick: () => {
						const count = change.op === 'replace' ? change.newCount : 1;
						if (focusMovedOutsideReplacement(deps.path, innerIndex, count)) return;
						if (change.op === 'replace' && change.newCount > 1) {
							const children = deps.node.children ?? [];
							const blocks = children.slice(change.at, change.at + change.newCount);
							const target = focusTargetInReplacement(blocks, focusOffset);
							state.innerBlockRefs[change.at + target.index]?.focus(target.offset);
							return;
						}
						state.innerBlockRefs[innerIndex]?.focus(focusOffset);
					}
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
