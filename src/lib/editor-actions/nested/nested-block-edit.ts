/**
 * A container's BlockEditActions: the shared `block-edit-core` against a container
 * `CommitScope`, plus what the core cannot own: the children guards, handing edge cases up to
 * `parent.blockEdit`, and the unwrap dispatch.
 */

import type { BlockEditActions } from '../../action-contracts';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { contentUpdate, createBlockEditCore } from '../block-edit-core';
import { withStoredCaret } from '../stored-caret';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { parent } = deps;
	const scope = createContainerScope(state, deps);
	const core = createBlockEditCore(scope);
	const writeContent = contentUpdate(scope);

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

		async insertParagraph(boundaryIndex, text) {
			if (!deps.node.children) return;
			await core.insertParagraph(boundaryIndex, text);
		},

		async mergeWithPrevious(innerIndex) {
			if (!deps.node.children) return;

			const unwrapRole = tryGetBlockKindDescriptor(deps.node.kind)?.unwrapRole;

			if (innerIndex <= 0) {
				if (unwrapRole) {
					await firstChildUnwrapStrategies[unwrapRole.firstChildBackspace]({ deps, state });
					return;
				}
				// A container with no unwrap role hands the merge to its parent. Awaited so the
				// caller's follow-up (focus placement) runs after the parent is done.
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

			// A collapsed container's body is unmounted, so forward Delete exits past the container
			// rather than stopping on the invisible body: a focus move, no edit. `append: false`
			// keeps the last-block case inert rather than appending a paragraph.
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

		updateBlockContent(innerIndex, text, mode, preEditOffset, postEditFocusOffset) {
			if (deps.node.children) {
				return writeContent(innerIndex, text, mode, preEditOffset, postEditFocusOffset);
			}
			return withStoredCaret(Promise.resolve(), postEditFocusOffset ?? preEditOffset ?? 0);
		}
	};

	return blockEdit;
}
