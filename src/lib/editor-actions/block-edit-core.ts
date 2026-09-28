/**
 * The structural edits shared by the top-level and container BlockEditActions, over a
 * `CommitScope`. Each method is the interior case only: no edge guards, no handing up to
 * the parent, no unwrap dispatch; the factories add those.
 */

import { tick } from 'svelte';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../block-component';
import type { CstNode } from '../core/nodes';
import {
	displayLength,
	documentLineEnding,
	ownTrailingLineEnding,
	withLineEnding
} from '../core/lines';
import type { BodyParent } from '../tree-operations/node-primitives';
import type { OpDescriptor } from '../schema/operations';
import { normalizeReplacementForBody } from '../tree-operations/paste/body-write';
import { landedPastePosition, trackedPasteCaret } from '../tree-operations/paste/focus-target';
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
import type {
	BlockEditActions,
	CommitAfterTick,
	LeafTextOptions,
	LeafWriteLanded,
	LeafWriteResult,
	ReplaceFocus,
	ReplaceOptions,
	ReplaceSource
} from '../action-contracts';
import {
	legalizeWrite,
	settledCaretPosition,
	updateNodeContent,
	type LegalWrite,
	type SettledContent
} from '../tree-operations/content-write';
import { createPathScope, landCaretInScope, type CommitScope } from './block-edit-scope';
import type { EditorRoot } from './deps';
import { docPathFrom } from '../cursor/coordinate-spaces';
import { mergedElseFocusNext, mergedElseFocusPrevious } from './merge-fallback';
import { previewContentReparse, landUnlessFocusMoved } from './replacement-focus';
import { admitsWrite } from './commit/reading-write-gate';
import { refusedWrite, withStoredCaret } from './stored-caret';

/** What both merge directions do when the neighbour cannot merge; `dir` names its side. */
async function handleIneligibleNeighbor(
	scope: CommitScope,
	i: number,
	dir: -1 | 1
): Promise<boolean> {
	const neighbor = i + dir;
	const neighborKind = scope.children()[neighbor].kind;
	// A neighbour focused as a whole is focused, not deleted: the first keypress highlights
	// it, a second deletes it. First so an editable but not mergeable kind never stops here.
	if (getBlockKindDescriptor(neighborKind).blockFocus === 'whole-block') {
		scope.refAt(neighbor)?.focus(0);
		return false;
	}
	if (isBlockEditable(neighborKind)) {
		scope.refAt(neighbor)?.focus(dir < 0 ? CURSOR_END : CURSOR_START);
		return false;
	}
	return scope.commit({
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
 * Every level's `updateBlockContent`: a commit when the trial reparse sees the block change, an
 * in-place write otherwise. Awaiting between the typing burst's undo entry and the commit splits it.
 */
export function contentUpdate(scope: CommitScope): BlockEditActions['updateBlockContent'] {
	return (index, text, mode, preEditOffset, postEditFocusOffset) => {
		scope.caretMemory.forget();
		const kind = () => scope.children()[index]?.kind;
		if (!admitsWrite(scope.reading, 'updateContent', kind)) return refusedWrite();
		const write = legalizeWrite(scope.target(), index, text, mode);
		const caret = write.storedOffset(postEditFocusOffset ?? preEditOffset ?? 0);
		// Decided before `work` first yields, which `typeIn` runs up to before it returns.
		let keepsCaret = false;
		const done = scope.typeIn(index, preEditOffset ?? 0, async () => {
			const trial = previewContentReparse(scope.target(), index, write, scope.reading.grammar);
			if (trial.op !== 'noop') {
				const landed = await commitLeafText(scope, index, write, {
					snapshotOffset: preEditOffset ?? 0,
					caret,
					afterTick: (landed) => landUnlessFocusMoved(scope, landed)
				});
				return landed.wrote;
			}
			const written = scope.writeInPlace(index, write, caret);
			if (!written.wrote) return false;
			keepsCaret = !written.relanding;
			if (!written.relanding) return true;
			await tick();
			await landUnlessFocusMoved(scope, written.relanding);
			return true;
		});
		return withStoredCaret(done, caret, write.storedOffset, keepsCaret);
	};
}

// ── One leaf's new text through a commit ─────────────────────────────────────

/**
 * Commit new text into child `index`. Offsets are in stored bytes: `snapshotOffset` is where undo
 * puts the caret back when nothing is focused, `caret` where it goes after the write.
 */
export async function commitLeafText(
	scope: CommitScope,
	index: number,
	write: LegalWrite,
	opts: {
		snapshotOffset: number;
		caret: number;
		/** Runs after the tick, before a collapsed ancestor places the caret itself. */
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

/**
 * {@link commitLeafText} for a caller holding the leaf's document path: `text` as written, made
 * legal against the leaf's parent, with `caret` an offset into it.
 */
export async function commitLeafTextAt(
	root: EditorRoot,
	leafPath: readonly number[],
	text: string,
	opts: LeafTextOptions
): Promise<LeafWriteResult> {
	const scope = createPathScope(root, docPathFrom(leafPath.slice(0, -1)));
	const index = leafPath[leafPath.length - 1];
	if (!scope || !scope.children()[index]) return { wrote: false };
	const write = legalizeWrite(scope.target(), index, text, 'literal');
	return commitLeafText(scope, index, write, {
		snapshotOffset: opts.snapshotOffset,
		caret: write.storedOffset(opts.caret),
		afterTick: opts.afterTick
	});
}

/**
 * A command's rewrite of the block at `path` in the document's line ending, its own undo entry
 * whatever typing came before; the caret moves to the block's start only when new blocks land.
 */
export async function replaceBlockRaw(
	root: EditorRoot,
	path: readonly number[],
	raw: string
): Promise<void> {
	const scope = createPathScope(root, docPathFrom(path.slice(0, -1)));
	const index = path[path.length - 1];
	if (!scope || !scope.children()[index]) return;
	const target = scope.target();
	const lineEnding = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
	const write = legalizeWrite(target, index, withLineEnding(raw, lineEnding), 'literal');
	await commitLeafText(scope, index, write, {
		snapshotOffset: 0,
		caret: 0,
		afterTick: (landed) => (landed.replaced ? landUnlessFocusMoved(scope, landed) : undefined)
	});
}

/** Each edit resolves to whether bytes landed. */
export interface BlockEditCore {
	split(i: number, offset: number): Promise<boolean>;
	descendToBody(i: number): Promise<boolean>;
	insertParagraph(i: number, text: string): Promise<boolean>;
	mergeWithPreviousInterior(i: number): Promise<boolean>;
	mergeWithNextInterior(i: number): Promise<boolean>;
	deleteInterior(i: number): Promise<boolean>;
	updateBlockMetadata(
		i: number,
		metadata: Record<string, unknown>,
		options?: { afterTick?: CommitAfterTick }
	): Promise<boolean>;
	/** Resolves to how many blocks landed in the position, or null when nothing was written. */
	replaceBlock(
		i: number,
		replacement: CstNode[],
		focus?: ReplaceFocus,
		options?: ReplaceOptions
	): Promise<number | null>;
}

/** The edit event a replace names: a paste route's source, else how many blocks landed. A
 *  container reports an empty replace as the delete it is. */
function replaceOp(
	scope: CommitScope,
	count: number,
	source: ReplaceSource | undefined
): OpDescriptor {
	if (source) return { kind: 'replaceBlock', detail: { source } };
	if (count === 0 && scope.collapseEmptyReplaceToDelete) return { kind: 'delete' };
	return { kind: 'replaceBlock', detail: { count } };
}

/** The clipboard's trailing blank line as the document's own, at its end when none is there yet
 *  and the document already ended in a line break. A container's body has no `suffix`. */
function landTrailingBlank(body: BodyParent, afterIndex: number, endedBefore: boolean): void {
	if (!endedBefore || body.suffix !== '' || afterIndex !== body.children.length) return;
	body.suffix = body.lineEnding;
}

export function createBlockEditCore(scope: CommitScope): BlockEditCore {
	const core: BlockEditCore = {
		async split(i, offset) {
			// The caret index is the primitive's answer, not `i + 1`: a first half that parses to
			// several blocks pushes the second half further down (G1.34 checks the index).
			let secondHalfIndex = i + 1;
			let split: SplitResult | undefined;
			return scope.commit({
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
				return false;
			}
			return scope.commit({
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
			return scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'insertBlock' },
				mutate: (view) => {
					const lineEnding = view.body.lineEnding;
					// Only a list's first block has no separator; anywhere else the new paragraph needs
					// a blank line after its predecessor, whatever the displaced sibling carried.
					const trivia = i > 0 ? lineEnding : (view.body.children[0]?.leadingTrivia ?? '');
					view.body.children.splice(i, 0, paragraphNode(trivia, text, lineEnding));
					const change: StructuralChange = { op: 'insert', at: i, count: 1 };
					stampStructuralChange(view.body.children, change, view.sharing);
					// The commit's blank-line fix-up cannot infer that the displaced sibling, pushed off
					// the first position, needs a separator, or that an empty paragraph is a blank line.
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

			if (!isMergeEligible(prevKind, currKind)) return handleIneligibleNeighbor(scope, i, -1);

			let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
			return scope.commit({
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

			if (!isMergeEligible(currKind, nextKind)) return handleIneligibleNeighbor(scope, i, 1);

			// The caret offset is the primitive's answer, not `displayLength` read beforehand: live
			// mode's clean-up at the join can drop marker runs and move where the two blocks met.
			let merged: MergeResult = { change: { op: 'noop' }, joinOffset: 0 };
			return scope.commit({
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
			return scope.commit({
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
			if (i < 0 || i >= children.length) return false;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return false;
			// `mutate` returns noop, so the stale-raw check needs the changed node named; the copy
			// exists only after unshareChild, so the commit reads this array after mutate.
			const touchedNodes: CstNode[] = [];
			return scope.commit({
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

		async replaceBlock(i, given, focus, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return null;
			// A replacement is built before any content write sees it, so the container's body rule
			// is applied here, to every block in it.
			const target = scope.target();
			const owner = 'owner' in target ? target.owner : undefined;
			const lineEnding = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
			const { replacement, mapIndex } = normalizeReplacementForBody(
				owner,
				given,
				lineEnding,
				scope.reading.grammar
			);
			const focusIndex = focus ? mapIndex(focus.replacementIndex) : 0;
			// The fix-up's merges can move where the caret belongs, so the commit keeps it updated.
			const tracked = focus
				? trackedPasteCaret(replacement, i, focusIndex, focus.offset)
				: undefined;
			// `snapshotOffset` is where the caret was, which undo restores; `focus.offset` is where
			// it lands. They differ when the replacement puts it inside a new structure.
			const snapshot = { index: i, offset: options?.snapshotOffset ?? focus?.offset ?? 0 };
			const wrote = await scope.commit({
				snapshot,
				eventTarget: i,
				op: replaceOp(scope, replacement.length, options?.source),
				trackCaret: tracked,
				mutate: (view) => {
					if (replacement.length === 0) {
						view.body.children.splice(i, 1);
						return { op: 'delete', at: i, count: 1 };
					}
					const old = view.body.children[i];
					// Read before the splice, for the task-marker rule below.
					const stood = taskMarkerMayStandBefore(old);
					const normalized = normalizeReplacementTrivia(old, replacement);
					for (const node of normalized) ensureEditableContainers(node, view.body.lineEnding);
					spliceMany(view.body.children, i, 1, normalized);
					// The first id carries over only to a block of the same kind, whose component the
					// position keeps; another kind mounts a component of its own anyway.
					const change: StructuralChange =
						normalized[0].kind === old.kind
							? replacePreservingFirst(i, 1, normalized.length)
							: { op: 'replace', at: i, count: 1, newCount: normalized.length };
					stampStructuralChange(view.body.children, change, view.sharing);
					// A new block in a list item's first position takes the task marker with the
					// paragraph that carried it; every replace reconciles it here.
					if (view.body.owner) reconcileTaskMetadata(view.body.owner, i, stood, view.sharing);
					if (options?.trailingBlank) {
						landTrailingBlank(
							view.body,
							i + normalized.length,
							ownTrailingLineEnding(old.raw) !== ''
						);
					}
					return change;
				},
				afterTick: async () => {
					if (!focus || !tracked || replacement.length === 0) return;
					if (focus.path) {
						await scope.land(scope.at(i + focusIndex, focus.path, focus.offset));
						return;
					}
					const at = landedPastePosition(scope.children()[tracked.index], tracked, focus.offset);
					await scope.land(scope.at(tracked.index, at.path, at.offset));
				}
			});
			return wrote ? replacement.length : null;
		}
	};

	return core;
}
