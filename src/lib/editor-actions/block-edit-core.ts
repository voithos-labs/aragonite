/**
 * The structural edits shared by the top-level and container BlockEditActions, over a
 * `CommitScope`. Each method is the interior case only: no edge guards, no handing up to
 * the parent, no unwrap dispatch; the factories add those.
 */

import { tick } from 'svelte';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
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
import type { BlockEditActions, CommitAfterTick, Relanding } from '../action-contracts';
import {
	legalizeWrite,
	settledCaretPosition,
	updateNodeContent,
	type LegalWrite,
	type SettledContent
} from '../tree-operations/content-write';
import { landCaretInScope, type CommitScope } from './block-edit-scope';
import { mergedElseFocusNext, mergedElseFocusPrevious } from './merge-fallback';
import { previewContentReparse, landUnlessFocusMoved } from './replacement-focus';
import { admitsWrite } from './commit/reading-write-gate';
import { withStoredCaret } from './stored-caret';

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
		mutate: (view) => performDelete(view.body, neighbor, view.reading.grammar, view.sharing),
		afterTick: () =>
			scope.refAt(dir < 0 ? neighbor : i)?.focus(dir < 0 ? CURSOR_START : CURSOR_END),
		discardIfNoop: true
	});
}

// ── The keystroke ────────────────────────────────────────────────────────────

/**
 * The `updateBlockContent` every level exposes: one keystroke's write, grouped with its typing
 * burst, through a commit when the trial reparse sees the block change and in place otherwise.
 * Nothing awaits between the burst's push and the commit call, or the commit opens an entry of its own.
 */
export function contentUpdate(scope: CommitScope): BlockEditActions['updateBlockContent'] {
	return (index, text, mode, preEditOffset, postEditFocusOffset) => {
		scope.caretMemory.forget();
		const write = legalizeWrite(scope.target(), index, text, mode);
		const caret = write.storedOffset(postEditFocusOffset ?? preEditOffset ?? 0);
		const kind = () => scope.children()[index]?.kind;
		if (!admitsWrite(scope.reading, 'updateContent', kind)) {
			return withStoredCaret(Promise.resolve(), caret, write.storedOffset);
		}
		const done = scope.typeIn(index, preEditOffset ?? 0, async () => {
			const trial = previewContentReparse(scope.target(), index, write, scope.reading.grammar);
			if (trial.op !== 'noop') {
				await commitLeafText(scope, index, write, {
					snapshotOffset: preEditOffset ?? 0,
					caret,
					afterTick: (landed) => landUnlessFocusMoved(scope, landed)
				});
				return;
			}
			const written = scope.writeInPlace(index, write, caret);
			if (!written.wrote || !written.relanding) return;
			await tick();
			await landUnlessFocusMoved(scope, written.relanding);
		});
		return withStoredCaret(done, caret, write.storedOffset);
	};
}

// ── One leaf's new text through a commit ─────────────────────────────────────

export type LeafWriteResult = { readonly wrote: false } | LeafWriteLanded;

/** `caret` is where the caret belongs after the write and the fix-up in its own list, and `window`
 *  the written block's replacement run after that fix-up. An ancestor that collapsed lands where
 *  the commit puts it, after this. */
export interface LeafWriteLanded extends Relanding {
	readonly wrote: true;
	/** Whether the write put new blocks in the position rather than rewriting the leaf. */
	readonly replaced: boolean;
}

/**
 * One commit writing new text into child `index`: the copy, the content write against the list's
 * body, and the caret after the write's own fix-up. `snapshotOffset` is where undo puts the caret
 * back when nothing is focused and `caret` the caret to carry through, both in the stored bytes.
 */
export async function commitLeafText(
	scope: CommitScope,
	index: number,
	write: LegalWrite,
	opts: {
		snapshotOffset: number;
		caret: number;
		/** Runs after the tick, before an ancestor's collapse lands the caret itself. */
		afterTick?: (landed: LeafWriteLanded) => void | Promise<void>;
	}
): Promise<LeafWriteResult> {
	let settled: SettledContent = { change: { op: 'noop' }, textStart: 0 };
	let landed: LeafWriteLanded | null = null;
	// A same-kind write reports `noop`, so the stale-raw check needs the leaf named.
	const touchedNodes: CstNode[] = [];
	const wrote = await scope.commit({
		snapshot: { index, offset: opts.snapshotOffset },
		eventTarget: index,
		op: { kind: 'updateContent', detail: { length: write.text.length } },
		touchedNodes,
		mutate: (view) => {
			view.unshareChild(index);
			settled = updateNodeContent(view.body, index, write, view.reading.grammar, view.sharing);
			touchedNodes.push(view.body.children[index]);
			stampStructuralChange(view.body.children, settled.change, view.sharing);
			return settled.change;
		},
		afterTick: async () => {
			const { change } = settled;
			const at = settledCaretPosition(settled, index, opts.caret, scope.children());
			const replaced = change.op === 'replace';
			landed = {
				wrote: true,
				caret: scope.at(at.index, [], at.offset),
				window: {
					list: scope.path,
					at: replaced ? change.at : index,
					count: replaced ? change.newCount : 1
				},
				replaced: change.op !== 'noop'
			};
			await opts.afterTick?.(landed);
		}
	});
	return wrote && landed ? landed : { wrote: false };
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
		options?: { afterTick?: CommitAfterTick }
	): Promise<void>;
	replaceBlock(
		i: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number; path?: number[] },
		options?: { snapshotOffset?: number }
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
					split = performSplit(view.body, i, offset, view.sharing, view.reading);
					secondHalfIndex = split.secondHalfIndex;
					stampStructuralChange(view.body.children, split.change, view.sharing);
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
					const body = emptyParagraph('', view.body.lineEnding);
					view.body.children.splice(i + 1, 0, body);
					const change: StructuralChange = { op: 'insert', at: i + 1, count: 1 };
					stampStructuralChange(view.body.children, change, view.sharing);
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
			await scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'insertBlock' },
				mutate: (view) => {
					const lineEnding = view.body.lineEnding;
					// Only the first block of a list owns no separator; anywhere else the new
					// paragraph needs a blank line after its predecessor, whatever the displaced
					// sibling carried.
					const trivia = i > 0 ? lineEnding : (view.body.children[0]?.leadingTrivia ?? '');
					view.body.children.splice(i, 0, paragraphNode(trivia, text, lineEnding));
					const change: StructuralChange = { op: 'insert', at: i, count: 1 };
					stampStructuralChange(view.body.children, change, view.sharing);
					// The new paragraph is a block of its own on both sides, which the commit's
					// blank-line fix-up cannot infer: the displaced sibling is no longer first, so
					// it needs its own separator, and an empty paragraph is itself a blank line.
					restoreSeparatorOnFill(view.body, i + 1, view.sharing);
					dropDoubledSeparator(view.body, i, view.sharing);
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
					mergeResult = mergeIntoPrevDeepLeaf(view.body, i, view.sharing, view.reading);
					return mergeResult?.change ?? { op: 'noop' };
				},
				afterTick: async () => {
					const merged = mergedElseFocusPrevious(mergeResult, scope.refAt(i - 1));
					if (!merged) return;
					// The fix-up after the delete can merge the joined block into the one above it.
					await landCaretInScope(scope, merged.index, merged.targetPath, merged.joinOffset);
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
					merged = performMergeNext(view.body, i, view.reading, view.sharing);
					stampStructuralChange(view.body.children, merged.change, view.sharing);
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
				mutate: (view) => performDelete(view.body, i, view.reading.grammar, view.sharing),
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
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				touchedNodes,
				mutate: (view) => {
					const node = view.unshareChild(i);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					// The chain rebuild re-derives the kind, since metadata can rewrite the opener
					// line (an alert's type). No collapses: this mutate reports `noop` for the list.
					const [reclassified] = rebuildUnsharedChain(
						{ children: view.body.children },
						[node],
						view.sharing,
						null,
						view.reading.grammar
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
			const snapshot = { index: i, offset: options?.snapshotOffset ?? focus?.offset ?? 0 };
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
						view.body.children.splice(i, 1);
						return { op: 'delete', at: i, count: 1 };
					}
					// Read before the splice, for the task-marker rule below.
					const stood = taskMarkerMayStandBefore(view.body.children[i]);
					const normalized = normalizeReplacementTrivia(view.body.children[i], replacement);
					for (const node of normalized) ensureEditableContainers(node, view.body.lineEnding);
					spliceMany(view.body.children, i, 1, normalized);
					const change = replacePreservingFirst(i, 1, normalized.length);
					stampStructuralChange(view.body.children, change, view.sharing);
					// One of the three writes that can put a new block in a list item's first
					// position, and so take the task marker with the paragraph that carried it.
					if (view.body.owner) reconcileTaskMetadata(view.body.owner, i, stood, view.sharing);
					return change;
				},
				afterTick: async () => {
					if (!focus || replacement.length === 0) return;
					await landCaretInScope(scope, i + focus.replacementIndex, focus.path ?? [], focus.offset);
				}
			});
		}
	};

	return core;
}
