/**
 * The structural edits shared by the top-level and container BlockEditActions, over a
 * `CommitScope`. Each method is the interior case only: no edge guards, no handing up to
 * the parent, no unwrap dispatch; the factories add those.
 */

import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import { displayLength, trailingLineEnding } from '../core/lines';
import {
	splitNode as performSplit,
	assertSplitLanding,
	type SplitResult,
	mergeWithNext as performMergeNext,
	type MergeResult,
	mergeIntoPrevDeepLeaf,
	deleteNode as performDelete,
	ensureEditableContainers,
	normalizeReplacementTrivia,
	rebuildUnsharedChain,
	restoreSeparatorOnFill,
	dropDoubledSeparator,
	emptyParagraph,
	paragraphNode,
	reconcileTaskMetadata,
	taskMarkerMayStandBefore
} from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { spliceMany } from '../tree-operations/splice-many';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CommitAfterTick, UndoEntryMode } from '../action-contracts';
import type { CommitScope, MutationView } from './block-edit-scope';
import { mergedElseFocusNext, mergedElseFocusPrevious } from './merge-fallback';

/** The owner the tree operations read, taken live off the commit's copied view. */
const bodyParentOf = (view: MutationView) => ({
	children: view.children,
	ownerKind: view.ownerKind,
	owner: view.owner
});

/** What both merge directions do when the neighbour cannot merge; `dir` names its side. */
async function handleIneligibleNeighbor(scope: CommitScope, i: number, dir: -1 | 1): Promise<void> {
	const neighbor = i + dir;
	const neighborKind = scope.children()[neighbor].kind;
	// A neighbour focused as a whole is focused, not deleted: the first keypress highlights
	// it, a second deletes it. First so an editable but not mergeable kind never stops here.
	if (getBlockKindDescriptor(neighborKind).blockFocus === 'whole-block') {
		scope.refAt(neighbor)?.focus(0);
		return;
	}
	if (isBlockEditable(neighborKind)) {
		scope.refAt(neighbor)?.focus(dir < 0 ? CURSOR_END : CURSOR_START);
		return;
	}
	await scope.commit({
		snapshot: { index: i, offset: dir < 0 ? 0 : CURSOR_END },
		eventTarget: neighbor,
		op: { kind: 'delete' },
		mutate: (view) => performDelete(bodyParentOf(view), neighbor, view.sharing),
		afterTick: () =>
			scope.refAt(dir < 0 ? neighbor : i)?.focus(dir < 0 ? CURSOR_START : CURSOR_END),
		discardIfNoop: true
	});
}

export interface BlockEditCore {
	split(i: number, offset: number): Promise<void>;
	descendToBody(i: number): Promise<void>;
	insertParagraph(i: number, text: string): Promise<void>;
	mergeWithPreviousInterior(i: number): Promise<void>;
	mergeWithNextInterior(i: number): Promise<void>;
	deleteInterior(i: number): Promise<void>;
	updateBlockMetadata(
		i: number,
		metadata: Record<string, unknown>,
		options?: { undoEntry?: UndoEntryMode; afterTick?: CommitAfterTick }
	): Promise<void>;
	replaceBlock(
		i: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number; path?: number[] },
		options?: { undoEntry?: UndoEntryMode; snapshotOffset?: number }
	): Promise<void>;
}

export function createBlockEditCore(scope: CommitScope): BlockEditCore {
	const core: BlockEditCore = {
		async split(i, offset) {
			// Offset 0 is not special: empty block above, content below, caret on the content. The
			// caret index is the primitive's answer, not `i + 1`: a first half that parses to
			// several blocks pushes the second half further down (G1.34 checks the index).
			let secondHalfIndex = i + 1;
			let split: SplitResult | undefined;
			await scope.commit({
				snapshot: { index: i, offset },
				eventTarget: i,
				op: { kind: 'split', detail: { at: offset } },
				mutate: (view) => {
					split = performSplit(
						bodyParentOf(view),
						i,
						offset,
						view.sharing,
						view.getPresentationMode?.(),
						view.linkRef,
						view.grammar
					);
					secondHalfIndex = split.secondHalfIndex;
					stampStructuralChange(view.children, split.change, view.sharing);
					return split.change;
				},
				afterTick: () => {
					if (split) assertSplitLanding(split, secondHalfIndex);
					scope.refAt(secondHalfIndex)?.focus(CURSOR_EXACT_START);
				},
				// A single-line block (a title row) splits to nothing, so discard rather than
				// push a dead undo entry on a rebound Enter.
				discardIfNoop: true
			});
		},

		async descendToBody(i) {
			const children = scope.children();
			// A body child already exists: a focus move, no undo entry. An absent ref (unmounted,
			// or a collapsed body) leaves the caret where it is, on purpose.
			if (i + 1 < children.length) {
				scope.refAt(i + 1)?.focus(CURSOR_START);
				return;
			}
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i + 1,
				op: { kind: 'appendBlock' },
				mutate: (view) => {
					// The new body line is nothing but a line ending, so it takes the title row's
					// (G4.20); a default LF would leave a lone LF in a CRLF container.
					const body = emptyParagraph('', trailingLineEnding(view.children[i]?.raw ?? '\n'));
					view.children.splice(i + 1, 0, body);
					const change: StructuralChange = { op: 'insert', at: i + 1, count: 1 };
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => scope.refAt(i + 1)?.focus(0)
			});
		},

		/**
		 * The paragraph the between-blocks caret creates (`selection/gap-caret.ts`). `i` is a
		 * boundary index, so `children.length` appends; the caret lands after the given text.
		 */
		async insertParagraph(i, text) {
			const children = scope.children();
			// The separator and the paragraph's own bytes are both line endings, so both take a
			// real neighbour's (G4.20); a boundary always has one on at least one side.
			const lineEnding = trailingLineEnding((children[i - 1] ?? children[i])?.raw ?? '\n');
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'insertBlock' },
				mutate: (view) => {
					// Only the first block of a list owns no separator; anywhere else the new
					// paragraph needs a blank line after its predecessor, whatever the displaced
					// sibling carried.
					const trivia = i > 0 ? lineEnding : (view.children[0]?.leadingTrivia ?? '');
					view.children.splice(i, 0, paragraphNode(trivia, text, lineEnding));
					const change: StructuralChange = { op: 'insert', at: i, count: 1 };
					stampStructuralChange(view.children, change, view.sharing);
					// The new paragraph is a block of its own on both sides, which the commit's
					// blank-line fix-up cannot infer: the displaced sibling is no longer first, so
					// it needs its own separator, and an empty paragraph is itself a blank line.
					const parent = bodyParentOf(view);
					restoreSeparatorOnFill(parent, i + 1, view.sharing);
					dropDoubledSeparator(parent, i, view.sharing);
					return change;
				},
				afterTick: () => scope.refAt(i)?.focus(displayLength(text))
			});
		},

		async mergeWithPreviousInterior(i) {
			const children = scope.children();
			const prevKind = children[i - 1].kind;
			const currKind = children[i].kind;

			if (!isMergeEligible(prevKind, currKind)) {
				await handleIneligibleNeighbor(scope, i, -1);
				return;
			}

			let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'prev' } },
				mutate: (view) => {
					mergeResult = mergeIntoPrevDeepLeaf(
						bodyParentOf(view),
						i,
						view.sharing,
						view.getPresentationMode?.(),
						view.linkRef,
						view.grammar
					);
					return mergeResult?.change ?? { op: 'noop' };
				},
				afterTick: () => {
					const ref = scope.refAt(i - 1);
					const merged = mergedElseFocusPrevious(mergeResult, ref);
					if (!merged) return;
					if (merged.targetPath.length === 0) ref?.focus(merged.joinOffset);
					else ref?.focusByPath?.(merged.targetPath, merged.joinOffset);
				},
				// A merge with no target changes nothing; discard the undo entry but keep
				// afterTick, which still places the caret.
				discardIfNoop: true
			});
		},

		async mergeWithNextInterior(i) {
			const children = scope.children();
			const currKind = children[i].kind;
			const nextKind = children[i + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				await handleIneligibleNeighbor(scope, i, 1);
				return;
			}

			// The caret offset is the primitive's answer, not `displayLength` read beforehand:
			// live mode's clean-up at the join drops marker runs on the first block's side and
			// moves where the two met.
			let merged: MergeResult = { change: { op: 'noop' }, joinOffset: 0 };
			await scope.commit({
				snapshot: { index: i, offset: CURSOR_END },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'next' } },
				mutate: (view) => {
					merged = performMergeNext(
						{ children: view.children },
						i,
						view.getPresentationMode?.(),
						view.linkRef,
						view.grammar
					);
					stampStructuralChange(view.children, merged.change, view.sharing);
					return merged.change;
				},
				afterTick: () => {
					if (mergedElseFocusNext(merged.change, scope.refAt(i + 1))) {
						scope.refAt(i)?.focus(merged.joinOffset);
					}
				},
				discardIfNoop: true
			});
		},

		async deleteInterior(i) {
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'delete' },
				mutate: (view) => performDelete(bodyParentOf(view), i, view.sharing),
				afterTick: () => {
					const focusIdx = Math.min(i, scope.children().length - 1);
					if (focusIdx >= 0) scope.refAt(focusIdx)?.focus(CURSOR_START);
				},
				discardIfNoop: true
			});
		},

		async updateBlockMetadata(i, metadata, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return;
			// `mutate` returns noop, so the commit's dev-mode stale-raw check cannot infer the
			// changed node. The copy exists only after unshareChild, hence a stable array the
			// commit reads after mutate.
			const touchedNodes: CstNode[] = [];
			await scope.commit({
				snapshot: options?.undoEntry === 'join' ? 'skip' : { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				touchedNodes,
				mutate: (view) => {
					const node = view.unshareChild(i);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Through `rebuildUnsharedChain`, not a bare rebuild: metadata can feed the
					// container's opener line (an alert's type), so the rebuilt bytes may parse as
					// a different kind, and the top-level commit runs no chain rebuild of its own.
					// `folds: null` because the rebuild root is the commit's own children array,
					// whose change this mutate has already fixed as `noop`.
					const [reclassified] = rebuildUnsharedChain(
						{ children: view.children },
						[node],
						view.sharing,
						null,
						view.grammar
					);
					touchedNodes.push(reclassified?.replacement ?? node);
					return { op: 'noop' };
				},
				afterTick: options?.afterTick
			});
		},

		async replaceBlock(i, replacement, focus, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return;
			// `snapshotOffset` is where the caret was, which undo restores; `focus.offset` is where
			// it lands. They differ when the replacement puts it inside a new structure.
			const snapshot =
				options?.undoEntry === 'join'
					? 'skip'
					: { index: i, offset: options?.snapshotOffset ?? focus?.offset ?? 0 };
			await scope.commit({
				snapshot,
				eventTarget: i,
				// The op kind for an empty replace is per level: top-level emits
				// `replaceBlock{count:0}`, a container `delete`. The change is `delete` either way.
				op:
					replacement.length === 0
						? scope.collapseEmptyReplaceToDelete
							? { kind: 'delete' }
							: { kind: 'replaceBlock', detail: { count: 0 } }
						: { kind: 'replaceBlock', detail: { count: replacement.length } },
				mutate: (view) => {
					if (replacement.length === 0) {
						view.children.splice(i, 1);
						return { op: 'delete', at: i, count: 1 };
					}
					// Read before the splice, for the task-marker rule below.
					const stood = taskMarkerMayStandBefore(view.children[i]);
					const normalized = normalizeReplacementTrivia(view.children[i], replacement);
					for (const node of normalized) ensureEditableContainers(node);
					spliceMany(view.children, i, 1, normalized);
					const change = replacePreservingFirst(i, 1, normalized.length);
					stampStructuralChange(view.children, change, view.sharing);
					// One of the three writes that can put a new block in a list item's first
					// position, and so take the task marker with the paragraph that carried it.
					if (view.owner) reconcileTaskMetadata(view.owner, i, stood, view.sharing);
					return change;
				},
				afterTick: () => {
					if (!focus || replacement.length === 0) return;
					const ref = scope.refAt(i + focus.replacementIndex);
					if (focus.path?.length) ref?.focusByPath?.(focus.path, focus.offset);
					else ref?.focus(focus.offset);
				}
			});
		}
	};

	return core;
}
