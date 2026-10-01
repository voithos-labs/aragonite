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
import { refusedWrite } from '../stored-caret';
import { removeEmptiedContainer } from './emptied-container';
import { isWhitespaceChar } from '../../core/lines';
import { writeMarkerSpace } from '../../schema/child-spans';
import { rawOffsetOfLeaf } from '../../tree-operations/container-offsets';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { parent } = deps;
	const scope = createContainerScope(state, deps);
	const core = createBlockEditCore(scope);
	const writeContent = contentUpdate(scope);
	const takesLastChild = () => (deps.node.children?.length ?? 0) <= 1;

	const blockEdit: BlockEditActions = {
		// ── Structural mutations (interior → core, edges → parent) ─────────────
		async splitBlock(innerIndex, offset) {
			if (!deps.node.children) return false;
			return core.split(innerIndex, offset);
		},

		async descendToBody(innerIndex) {
			if (!deps.node.children) return false;
			return core.descendToBody(innerIndex);
		},

		async insertParagraph(boundaryIndex, text) {
			if (!deps.node.children) return false;
			return core.insertParagraph(boundaryIndex, text);
		},

		async mergeWithPrevious(innerIndex) {
			if (!deps.node.children) return false;

			const unwrapRole = tryGetBlockKindDescriptor(deps.node.kind)?.unwrapRole;

			if (innerIndex <= 0) {
				if (unwrapRole) {
					return firstChildUnwrapStrategies[unwrapRole.firstChildBackspace]({ deps, state });
				}
				// A container with no unwrap role hands the merge to its parent.
				return parent.blockEdit.mergeWithPrevious(deps.index);
			}

			if (unwrapRole && unwrapRole.middleChildBackspace !== 'default-merge') {
				return middleChildUnwrapStrategies[unwrapRole.middleChildBackspace](
					{ deps, state },
					innerIndex
				);
			}

			return core.mergeWithPreviousInterior(innerIndex);
		},

		async mergeWithNext(innerIndex) {
			if (!deps.node.children) return false;

			if (innerIndex >= deps.node.children.length - 1) {
				return parent.blockEdit.mergeWithNext(deps.index);
			}

			// A collapsed container's body is unmounted, so forward Delete moves focus past the
			// container without editing; `append: false` keeps a last block from appending one.
			if (isCollapsedContainer(deps.node)) {
				await parent.focus.moveFocus(deps.index + 1, 'start', { append: false });
				return false;
			}

			return core.mergeWithNextInterior(innerIndex);
		},

		async deleteBlock(innerIndex, gesture) {
			if (!deps.node.children) return false;
			if (takesLastChild()) return removeEmptiedContainer(deps, gesture);
			return core.deleteInterior(innerIndex, gesture);
		},

		updateBlockMetadata: (innerIndex, metadata, options) =>
			core.updateBlockMetadata(innerIndex, metadata, options),

		async replaceBlock(innerIndex, replacement, focus, options) {
			if (replacement.length === 0 && takesLastChild()) {
				return removeEmptiedContainer(deps, 'keyless');
			}
			return (await core.replaceBlock(innerIndex, replacement, focus, options)) !== null;
		},

		updateBlockContent(innerIndex, text, mode, preEditOffset, postEditFocusOffset) {
			if (!deps.node.children) return refusedWrite();
			return writeContent(innerIndex, text, mode, preEditOffset, postEditFocusOffset);
		},

		async completeMarker(innerIndex) {
			const at = deps.node.children ? rawOffsetOfLeaf(deps.node, [innerIndex], 0) : null;
			// The marker already ends in a space or tab, or the child isn't where its bytes say.
			if (at === null || at === 0 || isWhitespaceChar(deps.node.raw[at - 1])) return false;
			return scope.commit({
				snapshot: { index: innerIndex, offset: 0 },
				eventTarget: innerIndex,
				op: { kind: 'updateContent', detail: { length: 0 } },
				// The rebuild after this keeps the container line it finds, space and all.
				mutate: (view) => {
					writeMarkerSpace(view.body.owner!, at);
					return { op: 'noop' };
				},
				landing: () => scope.at(innerIndex, [], 0)
			});
		},

		// Unwrapped, this bundle completes no line, as its `splitBlock` doesn't; `withEnterCompletion`
		// adds both above the container's overrides.
		completeLineOnType: async () => false
	};

	return blockEdit;
}
