/**
 * Scope-parameterized structural-edit core shared by the top-level and
 * container BlockEditActions factories. Each method is the interior body —
 * no edge guards, no upward delegation, no unwrap dispatch; the factories
 * wrap these with their level-specific concerns. Behavior is pinned by
 * block-edit-core.test.ts plus the two factories' e2e + the simulation.
 *
 * insertParsedBlocks is deliberately NOT here: the top-level path emits a
 * `paste` op while the container path routes through `replaceBlock` (G2.9
 * dual-emit invariant), so it cannot be a single shared body. Each factory
 * keeps its own.
 */

import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
import {
	splitNode as performSplit,
	bumpLeadingTrivia,
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
import type { UndoEntryMode } from '../action-contracts';
import type { CommitScope } from './block-edit-scope';

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
			const children = scope.children();
			if (offset === 0 && displayLength(children[i].raw) > 0) {
				// performSplit at offset 0 of a non-empty block would synthesize an
				// empty leading paragraph whose '\n' collapses into trivia on reparse,
				// desyncing the live tree from serialize(parse(source)). Bump the
				// block's own leadingTrivia instead. (Empty blocks fall through to the
				// normal [empty, empty] split — intended rapid-Enter behavior.)
				await scope.commit({
					snapshot: { index: i, offset: 0 },
					eventTarget: i,
					op: { kind: 'split', detail: { at: 0 } },
					mutate: (view) => {
						view.unshareChild(i);
						return bumpLeadingTrivia({ children: view.children }, i);
					},
					afterTick: () => scope.refAt(i)?.focus(0)
				});
				return;
			}
			await scope.commit({
				snapshot: { index: i, offset },
				eventTarget: i,
				op: { kind: 'split', detail: { at: offset } },
				mutate: (view) => {
					const change = performSplit({ children: view.children }, i, offset);
					stampStructuralChange(view.children, change, view.sharing);
					return change;
				},
				afterTick: () => scope.refAt(i + 1)?.focus(0)
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
				if (!isBlockEditable(prevKind)) {
					await scope.commit({
						snapshot: { index: i, offset: 0 },
						eventTarget: i - 1,
						op: { kind: 'delete' },
						mutate: (view) => performDelete({ children: view.children }, i - 1, view.sharing),
						afterTick: () => scope.refAt(i - 1)?.focus(0)
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
					if (!mergeResult) {
						scope.refAt(i - 1)?.focus(CURSOR_END);
						return;
					}
					const ref = scope.refAt(i - 1);
					if (mergeResult.targetPath.length === 0) ref?.focus(mergeResult.joinOffset);
					else ref?.focusByPath?.(mergeResult.targetPath, mergeResult.joinOffset);
				}
			});
		},

		async mergeWithNextInterior(i) {
			const children = scope.children();
			const currKind = children[i].kind;
			const nextKind = children[i + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					await scope.commit({
						snapshot: { index: i, offset: CURSOR_END },
						eventTarget: i + 1,
						op: { kind: 'delete' },
						mutate: (view) => performDelete({ children: view.children }, i + 1, view.sharing),
						afterTick: () => scope.refAt(i)?.focus(CURSOR_END)
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
				afterTick: () => scope.refAt(i)?.focus(mergeOffset)
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
				}
			});
		},

		async updateBlockMetadata(i, metadata, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return;
			await scope.commit({
				snapshot: options?.undoEntry === 'join' ? 'skip' : { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				mutate: (view) => {
					const node = view.unshareChild(i);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// Metadata feeds raw for list items (taskMarker) — resync so the
					// ceremony's rebuild concatenates fresh raw.
					rebuildOwnedContainer(node, view.sharing);
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
