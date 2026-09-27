/**
 * A container's BlockEditActions. Interior edits go through the shared `block-edit-core`
 * against a container `CommitScope`; this wrapper owns what the core cannot: the children
 * guards, handing edge cases up to `parent.blockEdit`, the unwrap dispatch, and
 * `updateBlockContent`.
 */

import { tick } from 'svelte';
import type { BlockEditActions } from '../../action-contracts';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { updateNodeContent as performUpdate, ensureUnsharedChild } from '../../tree-operations';
import {
	legalizeWrite,
	type LegalWrite,
	type SettledContent
} from '../../tree-operations/content-write';
import { followsTaskMarker } from '../../tree-operations/list/task-paragraph';
import { stampStructuralChange } from '../../tree-operations/structural-change';
import { tryGetBlockKindDescriptor, type WriteMode } from '../../schema/block-kind-descriptor';
import { isCollapsedContainer } from '../../schema/reserved-chrome';
import { assertInvariant } from '../../assert';
import type { NestedActionsDeps } from './nested-actions';
import { firstChildUnwrapStrategies, middleChildUnwrapStrategies } from '../unwrap-strategies';
import { createContainerScope } from '../block-edit-scope';
import { createBlockEditCore } from '../block-edit-core';
import { previewContentReparse, focusAfterContentReplace } from '../replacement-focus';
import { extendDocPath } from '../../cursor/coordinate-spaces';
import { withStoredCaret } from '../stored-caret';

export function createNestedBlockEdit(
	state: BlockListState,
	deps: NestedActionsDeps
): BlockEditActions {
	const { parent } = deps;
	const scope = createContainerScope(state, deps);
	const core = createBlockEditCore(scope);

	/** `text` made legal as the child at `innerIndex`, read against the container before the write. */
	function legalize(innerIndex: number, text: string, mode: WriteMode): LegalWrite | null {
		if (!deps.node.children) return null;
		const body = {
			children: deps.node.children,
			owner: deps.node,
			lineEnding: parent.containerEdit.lineEnding()
		};
		return legalizeWrite(body, innerIndex, text, mode);
	}

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
			const write = legalize(innerIndex, text, mode);
			const caret = write ? write.storedOffset(asked) : asked;
			const work = write
				? applyContentUpdate(innerIndex, write, preEditOffset, caret)
				: Promise.resolve();
			// The batch's pause timer starts once this keystroke's own work is done, throw
			// included: a batch whose timer never started never ends by pause.
			return withStoredCaret(
				work.finally(() => parent.containerEdit.armDebouncedPause()),
				caret,
				write?.storedOffset
			);
		}
	};

	async function applyContentUpdate(
		innerIndex: number,
		write: LegalWrite,
		preEditOffset: number | undefined,
		focusOffset: number
	): Promise<void> {
		if (!deps.node.children) return;
		const { text } = write;

		// No trailing-line suffix: only the document keeps its last blank line in a suffix, a
		// container does not.
		const preview = previewContentReparse(
			deps.node.children[innerIndex],
			write,
			deps.reading.grammar,
			deps.node,
			'',
			parent.containerEdit.lineEnding(),
			followsTaskMarker(deps.node, innerIndex) ? deps.node : undefined
		);

		const leafPath = extendDocPath(deps.path, innerIndex);

		if (preview.op !== 'noop') {
			let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
			await parent.containerEdit.commitContainer({
				containerNode: deps.node,
				path: deps.path,
				state,
				snapshot: { path: leafPath, offset: preEditOffset ?? 0 },
				mutate: (scope) => {
					ensureUnsharedChild(scope.node, innerIndex, scope.sharing);
					settled = performUpdate(
						scope.body,
						innerIndex,
						write,
						deps.reading.grammar,
						scope.sharing
					);
					stampStructuralChange(scope.children, settled.change, scope.sharing);
					return settled.change;
				},
				op: {
					kind: 'updateContent',
					detail: { length: text.length },
					eventPath: leafPath
				},
				afterTick: () =>
					focusAfterContentReplace(deps.path, innerIndex, settled, focusOffset, scope)
			});
			return;
		}

		// Routine typing: the debounced undo path, no structural commit. The inner leaf's id is
		// the batch key, so a focus move between sibling leaves breaks the batch.
		parent.containerEdit.pushDebouncedCheckpoint(
			leafPath,
			preEditOffset ?? 0,
			state.innerBlockIds[innerIndex]
		);
		let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
		const reclassified = parent.containerEdit.withUnsharedSpine(leafPath, (chain, sharing) => {
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
			settled = performUpdate(
				{
					children: ownedContainer.children,
					owner: ownedContainer,
					lineEnding: parent.containerEdit.lineEnding()
				},
				innerIndex,
				write,
				deps.reading.grammar,
				sharing
			);
			return settled.change;
		});
		parent.containerEdit.nudgeReactivity();
		// The rebuild changed the kind of a container above the leaf (a typed `> [!TIP]` marker
		// moves into the container's own bytes), so the edited leaf no longer exists. Re-enter
		// at the container's start; its focus walk lands in the body.
		if (reclassified) {
			await tick();
			await parent.focus.moveFocus(deps.index, 'start');
			return;
		}
		// Filling a blank block can merge it into a neighbour here, which the single-node trial
		// cannot see; `withUnsharedSpine` wrote the splice to state, and the caret follows the
		// bytes as they now lie.
		if (settled.change.op === 'noop') return;
		await tick();
		await focusAfterContentReplace(deps.path, innerIndex, settled, focusOffset, scope);
	}

	return blockEdit;
}
