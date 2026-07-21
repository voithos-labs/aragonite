/**
 * Scope-parameterized structural-edit core shared by the top-level and
 * container BlockEditActions factories. Each method is the interior body —
 * no edge guards, no upward delegation, no unwrap dispatch; the factories
 * wrap these with their level-specific concerns. Behavior is pinned by
 * block-edit-core.test.ts plus the two factories' e2e + the simulation.
 */

import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
import {
	splitNode as performSplit,
	mergeWithNext as performMergeNext,
	mergeIntoPrevDeepLeaf,
	deleteNode as performDelete,
	ensureEditableContainers,
	normalizeReplacementTrivia,
	rebuildOwnedContainer
} from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { UndoEntryMode } from '../action-contracts';
import type { CommitScope } from './block-edit-scope';
import { mergedElseFocusPrevious } from './merge-fallback';

export interface BlockEditCore {
	split(i: number, offset: number): Promise<void>;
	descendToBody(i: number): Promise<void>;
	mergeWithPreviousInterior(i: number): Promise<void>;
	mergeWithNextInterior(i: number): Promise<void>;
	deleteInterior(i: number): Promise<void>;
	updateBlockMetadata(
		i: number,
		metadata: Record<string, unknown>,
		options?: { undoEntry?: UndoEntryMode; afterTick?: () => void }
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
			// Offset 0 is not special: empty block above, content below, caret
			// staying on the content — the leading empty half collapsing to trivia
			// on reparse is the same tolerated live state Enter-at-end produces.
			// A trivia-bump short-circuit here once made Enter at block start an
			// invisible no-op.
			await scope.commit({
				snapshot: { index: i, offset },
				eventTarget: i,
				op: { kind: 'split', detail: { at: offset } },
				mutate: (view) => {
					const change = performSplit({ children: view.children }, i, offset);
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => scope.refAt(i + 1)?.focus(0),
				// A single-line/chrome block splits to nothing (splitNode noops on a
				// contextDependentKind); discard so a rebound Enter mints no dead entry.
				discardIfNoop: true
			});
		},

		async descendToBody(i) {
			const children = scope.children();
			// A body child already exists: pure focus move, no document change and no
			// undo entry. An absent ref (windowed-out or a collapsed body) no-ops the
			// focus, leaving the caret put — the load-bearing collapsed-body fallback.
			if (i + 1 < children.length) {
				scope.refAt(i + 1)?.focus(0);
				return;
			}
			// Chrome is the only child: mint an empty body paragraph after it, then focus.
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i + 1,
				op: { kind: 'appendBlock' },
				mutate: (view) => {
					const body: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
					view.children.splice(i + 1, 0, body);
					const change: StructuralChange = { op: 'insert', at: i + 1, count: 1 };
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => scope.refAt(i + 1)?.focus(0)
			});
		},

		async mergeWithPreviousInterior(i) {
			const children = scope.children();
			const prevKind = children[i - 1].kind;
			const currKind = children[i].kind;

			if (!isMergeEligible(prevKind, currKind)) {
				// A whole-block-focus neighbor (opaque childless plugin block) is
				// focused, not deleted: press one highlights it, a second press on the
				// now-focused block deletes it. No commit, no undo entry — this is a
				// focus move, not a mutation. Ordered before the delete/move fallbacks
				// so a not-mergeable-but-editable kind (mermaid) never dead-ends here.
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
						afterTick: () => scope.refAt(i - 1)?.focus(0),
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
					mergeResult = mergeIntoPrevDeepLeaf({ children: view.children }, i, view.sharing);
					return mergeResult?.change ?? { op: 'noop' };
				},
				afterTick: () => {
					const ref = scope.refAt(i - 1);
					const merged = mergedElseFocusPrevious(mergeResult, ref);
					if (!merged) return;
					if (merged.targetPath.length === 0) ref?.focus(merged.joinOffset);
					else ref?.focusByPath?.(merged.targetPath, merged.joinOffset);
				},
				// A no-target merge (opaque prev leaf) changes nothing; discard the entry
				// but keep afterTick — mergedElseFocusPrevious still lands the caret.
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
					scope.refAt(i + 1)?.focus(0);
				}
				return;
			}

			const mergeOffset = displayLength(children[i].raw);
			await scope.commit({
				snapshot: { index: i, offset: CURSOR_END },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'next' } },
				mutate: (view) => {
					const change = performMergeNext({ children: view.children }, i);
					stampStructuralChange(view.children, change, view.sharing);
					return change;
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
					if (focusIdx >= 0) scope.refAt(focusIdx)?.focus(0);
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
			// node — name it. The owned copy exists only after unshareChild, so push into a
			// stable array the ceremony reads post-mutate.
			const touchedNodes: CstNode[] = [];
			await scope.commit({
				snapshot: options?.undoEntry === 'join' ? 'skip' : { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				touchedNodes,
				mutate: (view) => {
					const node = view.unshareChild(i);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Metadata feeds raw for list items (taskMarker) — resync so the
					// ceremony's rebuild concatenates fresh raw.
					rebuildOwnedContainer(node, view.sharing);
					touchedNodes.push(node);
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
