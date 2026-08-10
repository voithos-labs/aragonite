/**
 * Scope-parameterized structural-edit core shared by the top-level and container
 * BlockEditActions factories. Each method is the interior body only — no edge guards,
 * no upward delegation, no unwrap dispatch; the factories add those.
 */

import { CURSOR_END, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import { displayLength, trailingLineEnding } from '../core/lines';
import {
	splitNode as performSplit,
	mergeWithNext as performMergeNext,
	mergeIntoPrevDeepLeaf,
	deleteNode as performDelete,
	ensureEditableContainers,
	normalizeReplacementTrivia,
	rebuildUnsharedChain,
	restoreSeparatorOnFill,
	dropDoubledSeparator,
	emptyParagraph,
	paragraphNode
} from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { CommitAfterTick, UndoEntryMode } from '../action-contracts';
import type { CommitScope } from './block-edit-scope';
import { mergedElseFocusPrevious } from './merge-fallback';

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
		focus?: { replacementIndex: number; offset: number },
		options?: { undoEntry?: UndoEntryMode }
	): Promise<void>;
}

export function createBlockEditCore(scope: CommitScope): BlockEditCore {
	return {
		async split(i, offset) {
			// Offset 0 is not special: empty block above, content below, caret on the
			// content. A trivia-bump short-circuit here made Enter at block start a no-op.
			// The landing is the primitive's answer, not `i + 1`: a plural first half
			// pushes the second half further down (GH #98).
			let secondHalfIndex = i + 1;
			await scope.commit({
				snapshot: { index: i, offset },
				eventTarget: i,
				op: { kind: 'split', detail: { at: offset } },
				mutate: (view) => {
					const split = performSplit(
						{ children: view.children, ownerKind: view.ownerKind, owner: view.owner },
						i,
						offset,
						view.getPresentationMode?.(),
						view.linkRef
					);
					secondHalfIndex = split.secondHalfIndex;
					stampStructuralChange(view.children, split.change, view.sharing);
					return split.change;
				},
				afterTick: () => scope.refAt(secondHalfIndex)?.focus(0),
				// A single-line/chrome block splits to nothing, so discard rather than
				// mint a dead entry on a rebound Enter.
				discardIfNoop: true
			});
		},

		async descendToBody(i) {
			const children = scope.children();
			// A body child already exists: pure focus move, no undo entry. An absent ref
			// (windowed-out, or a collapsed body) leaves the caret put — load-bearing.
			if (i + 1 < children.length) {
				scope.refAt(i + 1)?.focus(CURSOR_START);
				return;
			}
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i + 1,
				op: { kind: 'appendBlock' },
				mutate: (view) => {
					// The synthesized body line IS a line ending, so it takes the chrome
					// sibling's (G4.20); a defaulted LF strands one in a CRLF container.
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
		 * The between-blocks caret's mint (`selection/gap-caret.ts`). `i` is a BOUNDARY index,
		 * so `children.length` appends; the caret lands after the text the paragraph carries.
		 */
		async insertParagraph(i, text) {
			const children = scope.children();
			// Both the separator and the paragraph's own bytes ARE line endings, so both take a
			// real neighbour's (G4.20); a boundary always has one on at least one side.
			const lineEnding = trailingLineEnding((children[i - 1] ?? children[i])?.raw ?? '\n');
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'insertBlock' },
				mutate: (view) => {
					// Only the scope's head block owns no separator; anywhere else the mint owes
					// its predecessor a blank line, whatever the displaced sibling carried.
					const trivia = i > 0 ? lineEnding : (view.children[0]?.leadingTrivia ?? '');
					view.children.splice(i, 0, paragraphNode(trivia, text, lineEnding));
					const change: StructuralChange = { op: 'insert', at: i, count: 1 };
					stampStructuralChange(view.children, change, view.sharing);
					// The displaced sibling is a body block now, not the head, so it owes its own
					// separator; an EMPTY mint is a blank line itself and shares the follower's.
					const parent = { children: view.children, ownerKind: view.ownerKind, owner: view.owner };
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
				// A whole-block-focus neighbor is focused, not deleted: press one
				// highlights it, a second press on the now-focused block deletes it.
				// Ordered first so a not-mergeable-but-editable kind never dead-ends here.
				if (getBlockKindDescriptor(prevKind).blockFocus === 'whole-block') {
					scope.refAt(i - 1)?.focus(0);
					return;
				}
				if (!isBlockEditable(prevKind)) {
					await scope.commit({
						snapshot: { index: i, offset: 0 },
						eventTarget: i - 1,
						op: { kind: 'delete' },
						mutate: (view) => performDelete({ children: view.children }, i - 1, view.sharing),
						afterTick: () => scope.refAt(i - 1)?.focus(CURSOR_START),
						discardIfNoop: true
					});
				} else {
					scope.refAt(i - 1)?.focus(CURSOR_END);
				}
				return;
			}

			let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'prev' } },
				mutate: (view) => {
					mergeResult = mergeIntoPrevDeepLeaf(
						{ children: view.children },
						i,
						view.sharing,
						view.getPresentationMode?.(),
						view.linkRef
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
				// A no-target merge changes nothing; discard the entry but keep afterTick,
				// which still lands the caret.
				discardIfNoop: true
			});
		},

		async mergeWithNextInterior(i) {
			const children = scope.children();
			const currKind = children[i].kind;
			const nextKind = children[i + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				// Forward twin of the whole-block-focus fallback: Delete at the end of
				// the block above focuses the opaque neighbor instead of deleting it.
				if (getBlockKindDescriptor(nextKind).blockFocus === 'whole-block') {
					scope.refAt(i + 1)?.focus(0);
					return;
				}
				if (!isBlockEditable(nextKind)) {
					await scope.commit({
						snapshot: { index: i, offset: CURSOR_END },
						eventTarget: i + 1,
						op: { kind: 'delete' },
						mutate: (view) => performDelete({ children: view.children }, i + 1, view.sharing),
						afterTick: () => scope.refAt(i)?.focus(CURSOR_END),
						discardIfNoop: true
					});
				} else {
					scope.refAt(i + 1)?.focus(CURSOR_START);
				}
				return;
			}

			// The landing is the primitive's answer, not `displayLength` read ahead of it: a live
			// seam cleanup drops runs on the first block's side and moves where the two met.
			let mergeOffset = displayLength(children[i].raw);
			await scope.commit({
				snapshot: { index: i, offset: CURSOR_END },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'next' } },
				mutate: (view) => {
					const merged = performMergeNext(
						{ children: view.children },
						i,
						view.getPresentationMode?.(),
						view.linkRef
					);
					mergeOffset = merged.joinOffset;
					stampStructuralChange(view.children, merged.change, view.sharing);
					return merged.change;
				},
				afterTick: () => scope.refAt(i)?.focus(mergeOffset),
				discardIfNoop: true
			});
		},

		async deleteInterior(i) {
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'delete' },
				mutate: (view) => performDelete({ children: view.children }, i, view.sharing),
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
			// `mutate` returns noop, so the ceremony's dev oracle can't infer the resynced
			// node. The owned copy exists only after unshareChild, hence a stable array
			// the ceremony reads post-mutate.
			const touchedNodes: CstNode[] = [];
			await scope.commit({
				snapshot: options?.undoEntry === 'join' ? 'skip' : { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				touchedNodes,
				mutate: (view) => {
					const node = view.unshareChild(i);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Through the chain funnel, not a bare rebuild: metadata can feed the
					// container's OPENER line (an alert's type), so the rebuilt bytes may open
					// as a different kind. The document branch runs no chain rebuild of its
					// own, so this is the only seam a top-level metadata write crosses.
					const [reclassified] = rebuildUnsharedChain(
						{ children: view.children },
						[node],
						view.sharing,
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
			const snapshot =
				options?.undoEntry === 'join' ? 'skip' : { index: i, offset: focus?.offset ?? 0 };
			await scope.commit({
				snapshot,
				eventTarget: i,
				// Empty-replace op-kind is per-scope: top-level emits `replaceBlock{count:0}`,
				// container collapses to `delete`. The structural change is `delete` either way.
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
					const normalized = normalizeReplacementTrivia(view.children[i], replacement);
					for (const node of normalized) ensureEditableContainers(node);
					view.children.splice(i, 1, ...normalized);
					const change = replacePreservingFirst(i, 1, normalized.length);
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => {
					if (focus && replacement.length > 0)
						scope.refAt(i + focus.replacementIndex)?.focus(focus.offset);
				}
			});
		}
	};
}
