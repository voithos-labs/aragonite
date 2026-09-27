/**
 * A container's BlockEditActions. Interior edits go through the shared `block-edit-core`
 * against a container `CommitScope`; this wrapper owns what the core cannot: the children
 * guards, handing edge cases up to `parent.blockEdit`, the unwrap dispatch, and
 * `updateBlockContent`.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../../action-contracts';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { legalizeWrite, type LegalWrite } from '../../tree-operations/content-write';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { commitLeafText, createBlockEditCore } from '../block-edit-core';
import { previewContentReparse, landUnlessFocusMoved } from '../replacement-focus';
import { withStoredCaret } from '../stored-caret';

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

		// ── In-place leaf edits (per-level) ────────────────────────────────────
		updateBlockContent(innerIndex, text, mode, preEditOffset, postEditFocusOffset) {
			const asked = postEditFocusOffset ?? preEditOffset ?? 0;
			if (!deps.node.children) return withStoredCaret(Promise.resolve(), asked);
			const write = legalizeWrite(scope.target(), innerIndex, text, mode);
			const caret = write.storedOffset(asked);
			const work = applyContentUpdate(innerIndex, write, preEditOffset, caret);
			return withStoredCaret(work, caret, write.storedOffset);
		}
	};

	async function applyContentUpdate(
		innerIndex: number,
		write: LegalWrite,
		preEditOffset: number | undefined,
		caret: number
	): Promise<void> {
		if (!deps.node.children) return;
		const preview = previewContentReparse(scope.target(), innerIndex, write, deps.reading.grammar);
		if (preview.op !== 'noop') {
			await commitLeafText(scope, innerIndex, write, {
				snapshotOffset: preEditOffset ?? 0,
				caret,
				afterTick: (landed) => landUnlessFocusMoved(scope, landed)
			});
			return;
		}
		scope.caretMemory.forget();
		await scope.typeIn(innerIndex, preEditOffset ?? 0, async () => {
			const written = scope.writeInPlace(innerIndex, write, caret);
			if (!written.wrote || !written.relanding) return;
			await tick();
			await landUnlessFocusMoved(scope, written.relanding);
		});
	}

	return blockEdit;
}
