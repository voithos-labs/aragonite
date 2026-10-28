/**
 * The structural edits shared by the top-level and container BlockEditActions, over a
 * `CommitScope`. Each method is the interior case only: no edge guards, no handing up to
 * the parent, no unwrap dispatch; the factories add those.
 */

import { tick } from 'svelte';
import { CURSOR_END, CURSOR_START } from '../block-component';
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
	type SplitResult,
	mergeWithNext as performMergeNext,
	type MergeResult,
	mergeIntoPrevDeepLeaf,
	deleteNode as performDelete,
	normalizeReplacementTrivia,
	restoreSeparatorOnFill,
	emptyParagraph,
	paragraphNode,
	landAtTaskStart,
	writeKeepingTaskMarker
} from '../tree-operations';
import { ensureEditableContainers } from '../schema/opened-reading';
import {
	replacePreservingFirst,
	stampStructuralChange,
	type StructuralChange
} from '../tree-operations/structural-change';
import { spliceMany } from '../tree-operations/splice-many';
import type { TrackedPosition } from '../tree-operations/fix-up/apply';
import type { TaskStartLanding } from '../tree-operations/list/reconcile-task';
import { isMergeEligible, isBlockEditable } from '../schema/merge-rules';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type {
	BlockCaret,
	BlockEditActions,
	LeafTextOptions,
	LeafWriteLanded,
	LeafWriteResult,
	ReplaceFocus,
	ReplaceOptions,
	ReplaceSource,
	UndoGrouping
} from '../action-contracts';
import {
	closeWrittenOpeners,
	legalizeWrite,
	settledCaretPosition,
	type LegalWrite,
	type FixedUpWrite
} from '../tree-operations/content-write';
import { createPathScope, type CommitScope } from './block-edit-scope';
import type { EditorRoot } from './deps';
import { docPathFrom, extendDocPath } from '../core/coordinate-spaces';
import { mergedElseNext, mergedElsePrevious } from './merge-fallback';
import { previewContentReparse, unlessFocusMoved } from './replacement-focus';
import type { CaretPosition, Landing } from '../selection/primitives';
import type { RevealPolicy } from '../selection/caret-landing';
import type { RemovalGesture } from '../selection/caret-target';
import { admitsWrite } from './commit/reading-write-gate';
import { refusedWrite, withStoredCaret } from './stored-caret';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkCaretInWrittenText } from '../invariants/write-caret';

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
		await scope.land(scope.at(neighbor, [], 0));
		return false;
	}
	if (isBlockEditable(neighborKind)) {
		await scope.land(scope.at(neighbor, [], dir < 0 ? CURSOR_END : CURSOR_START));
		return false;
	}
	return scope.commit({
		snapshot: { index: i, offset: dir < 0 ? 0 : CURSOR_END },
		eventTarget: neighbor,
		op: { kind: 'delete' },
		mutate: (view) => {
			view.describeEdit({ removed: true });
			return performDelete(view.body, neighbor, view.sharing);
		},
		// The block the key was pressed in, which a delete above has moved up to `neighbor`.
		landing: () => scope.at(dir < 0 ? neighbor : i, [], dir < 0 ? CURSOR_START : CURSOR_END),
		discardIfNoop: true
	});
}

// ── The keystroke ────────────────────────────────────────────────────────────

/** Every level's `updateBlockContent`: a commit when the trial reparse sees the block change, an
 *  in-place write otherwise, both in the entry `typeIn` pushed before the work's first await. */
export function contentUpdate(scope: CommitScope): BlockEditActions['updateBlockContent'] {
	return (index, text, mode, history, preEditOffset, postEditFocusOffset) => {
		scope.caretMemory.forget();
		assertInvariant('caret-in-written-text', () =>
			checkCaretInWrittenText(text, postEditFocusOffset ?? preEditOffset)
		);
		const kind = () => scope.children()[index]?.kind;
		if (!admitsWrite(scope, 'updateContent', kind)) return refusedWrite();
		const write = legalizeWrite(scope.target(), index, text, mode, scope.reading.grammar);
		const caret = write.storedOffset(postEditFocusOffset ?? preEditOffset);
		// Decided before `work` first yields, which `typeIn` runs up to before it returns.
		let keepsCaret = false;
		const done = scope.typeIn(index, preEditOffset, history, async () => {
			const trial = previewContentReparse(scope.target(), index, write, scope.reading.grammar);
			if (trial.op !== 'noop') {
				const landed = await commitLeafText(scope, index, write, {
					snapshotOffset: preEditOffset,
					caret,
					landing: unlessFocusMoved,
					history: 'join-typing'
				});
				return landed.wrote;
			}
			const written = scope.typeLeaf(index, write, caret);
			if (!written.wrote) return false;
			keepsCaret = !written.relanding;
			if (!written.relanding) return true;
			await tick();
			const relanding = unlessFocusMoved(written.relanding);
			if (relanding) await scope.land(relanding);
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
		/** Where the caret goes, from where the write left it; a collapsed ancestor overrides it. */
		landing?: (landed: LeafWriteLanded) => Landing | null;
		reveal?: RevealPolicy;
		/** `join-typing` for a keystroke, whose typing push already made the entry. */
		history?: UndoGrouping;
	}
): Promise<LeafWriteResult> {
	let readSettled = (): FixedUpWrite | null => null;
	let landed: LeafWriteLanded | null = null;
	// Read after the commit: the list's fix-up can move the written block.
	const readLanded = (): LeafWriteLanded => {
		const settled = readSettled() ?? { change: { op: 'noop' }, textStart: 0 };
		const { change } = settled;
		const at = settledCaretPosition(settled, index, opts.caret, scope.children());
		const replaced = change.op === 'replace';
		return {
			wrote: true,
			caret: scope.at(at.index, [], at.offset),
			window: {
				list: scope.path,
				at: replaced ? change.at : index,
				count: replaced ? change.newCount : 1
			},
			replaced: change.op !== 'noop'
		};
	};
	const wrote = await scope.commit({
		snapshot: { index, offset: opts.snapshotOffset },
		eventTarget: index,
		op: { kind: 'updateContent', detail: { length: write.text.length } },
		mutate: (view) => {
			const settled = view.writeLeaf([index], write);
			readSettled = () => settled;
			stampStructuralChange(view.body.children, settled.change, view.sharing);
			return settled.change;
		},
		landing: () => {
			landed ??= readLanded();
			return opts.landing?.(landed) ?? null;
		},
		reveal: opts.reveal,
		history: opts.history
	});
	// The result comes from the commit, not the landing: a collapsed ancestor's landing replaces
	// this one without calling it.
	if (!wrote) return { wrote: false };
	return landed ?? readLanded();
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
	const write = legalizeWrite(scope.target(), index, text, 'literal', scope.reading.grammar);
	return commitLeafText(scope, index, write, {
		snapshotOffset: opts.snapshotOffset,
		caret: write.storedOffset(opts.caret),
		landing: opts.landing
	});
}

/** Each edit resolves to whether bytes landed. */
export interface BlockEditCore {
	split(i: number, offset: number): Promise<boolean>;
	descendToBody(i: number): Promise<boolean>;
	insertParagraph(i: number, text: string): Promise<boolean>;
	mergeWithPreviousInterior(i: number): Promise<boolean>;
	mergeWithNextInterior(i: number): Promise<boolean>;
	deleteInterior(i: number, gesture: RemovalGesture): Promise<boolean>;
	updateBlockMetadata(
		i: number,
		metadata: Record<string, unknown>,
		options?: { caret?: BlockCaret }
	): Promise<boolean>;
	replaceRaw(i: number, raw: string, caret?: number): Promise<boolean>;
	/** Resolves to how many blocks landed in the position, or null when nothing was written. */
	replaceBlock(
		i: number,
		replacement: CstNode[],
		focus: ReplaceFocus | undefined,
		options: ReplaceOptions
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

/** The caller's focus in the blocks that land: past the body rule's escapes, and moved with its
 *  bytes when a to-do's first slot reads the blocks as its text. */
function landedFocus(
	focus: ReplaceFocus,
	mapIndex: (index: number) => number,
	atTaskStart: TaskStartLanding | null
): ReplaceFocus {
	const index = mapIndex(focus.replacementIndex);
	if (!atTaskStart) return { ...focus, replacementIndex: index };
	const moved = atTaskStart.caretAt(index, focus.offset);
	return { replacementIndex: moved.index, offset: moved.offset };
}

/** A leaf's metadata is what its opener reads from its bytes, so a metadata write there could not
 *  survive a reload; it is refused, in every build, before anything is written (G1.110). */
function refuseLeafMetadata(scope: CommitScope, i: number, kind: string): void {
	const message =
		`updateBlockMetadata wrote nothing: '${kind}' is a leaf, whose metadata comes from its ` +
		"bytes. A leaf's command rewrites them with replaceRaw.";
	assertInvariant('metadata-without-rebuild', () => ({
		code: 'metadata-without-rebuild',
		message
	}));
	scope.reportCommitError(new Error(`aragonite: ${message}`), 'metadataUpdate', i);
}

/** Where an offset in `before` sits in `after`: on the same text when it is outside the span the
 *  rewrite changed, else at the end of what replaced that span. */
function offsetThroughRewrite(before: string, after: string, offset: number): number {
	const shorter = Math.min(before.length, after.length);
	let head = 0;
	while (head < shorter && before[head] === after[head]) head++;
	let tail = 0;
	while (tail < shorter - head && before.at(-1 - tail) === after.at(-1 - tail)) tail++;
	if (offset <= head) return offset;
	if (offset >= before.length - tail) return offset + after.length - before.length;
	return after.length - tail;
}

export function createBlockEditCore(scope: CommitScope): BlockEditCore {
	const core: BlockEditCore = {
		async split(i, offset) {
			let split: SplitResult | undefined;
			return scope.commit({
				snapshot: { index: i, offset },
				eventTarget: i,
				op: { kind: 'split', detail: { at: offset } },
				mutate: (view) => {
					split = performSplit(view.body, i, offset, view.sharing, view.reading);
					stampStructuralChange(view.body.children, split.change, view.sharing);
					return split.change;
				},
				// The primitive's index, not `i + 1`: a first half that parses to several blocks
				// pushes the second half further down.
				landing: () =>
					split
						? { ...scope.at(split.secondHalfIndex, [], split.landingOffset), fresh: true }
						: null,
				// A single-line block (a title row) splits to nothing, so discard rather than
				// push a dead undo entry on a rebound Enter.
				discardIfNoop: true
			});
		},

		async descendToBody(i) {
			const children = scope.children();
			// A body child already exists: a focus move, no undo entry.
			if (i + 1 < children.length) {
				await scope.land(scope.at(i + 1, [], CURSOR_START));
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
				landing: () => scope.at(i + 1, [], 0)
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
					// the first position, needs a separator.
					restoreSeparatorOnFill(view.body, i + 1, view.sharing);
					return change;
				},
				landing: () => scope.at(i, [], displayLength(text))
			});
		},

		async mergeWithPreviousInterior(i) {
			const children = scope.children();
			const prevKind = children[i - 1].kind;
			const currKind = children[i].kind;

			if (!isMergeEligible(prevKind, currKind)) return handleIneligibleNeighbor(scope, i, -1);

			let mergeResult: ReturnType<typeof mergeIntoPrevDeepLeaf> = null;
			const tracked: TrackedPosition = { index: -1, offset: 0 };
			const joinedAt = (): CaretPosition | null => {
				if (!mergeResult) return null;
				const join = mergeResult.landing(scope.children());
				return scope.at(join.index, join.targetPath, join.joinOffset);
			};
			return scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'merge', detail: { direction: 'prev' } },
				mutate: (view) => {
					mergeResult = mergeIntoPrevDeepLeaf(view.body, i, view.sharing, view.reading, tracked);
					if (!mergeResult) return { op: 'noop' };
					view.describeEdit({ removed: true });
					return mergeResult.change;
				},
				trackCaret: tracked,
				// The primitive's answer, since the fix-up after the delete can merge the joined
				// block into the one above it.
				landing: () => mergedElsePrevious(joinedAt(), extendDocPath(scope.path, i - 1)),
				// A merge with no target changes nothing; discard the undo entry, and the landing
				// still moves the caret.
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
				landing: () =>
					mergedElseNext(
						merged.change,
						scope.at(i, [], merged.joinOffset),
						extendDocPath(scope.path, i + 1)
					),
				discardIfNoop: true
			});
		},

		async deleteInterior(i, gesture) {
			return scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'delete' },
				mutate: (view) => {
					view.describeEdit({ removed: true });
					return performDelete(view.body, i, view.sharing);
				},
				landing: () => scope.survivor(i, gesture),
				discardIfNoop: true
			});
		},

		async updateBlockMetadata(i, metadata, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return false;
			const fields = Object.keys(metadata);
			if (fields.length === 0) return false;
			if (!getBlockKindDescriptor(children[i].kind).isContainer) {
				refuseLeafMetadata(scope, i, children[i].kind);
				return false;
			}
			return scope.commit({
				snapshot: { index: i, offset: 0 },
				eventTarget: i,
				op: { kind: 'metadataUpdate', detail: { fields } },
				mutate: (view) => {
					// Owned, so the commit rebuilds it and re-derives its kind: metadata can rewrite the
					// opener line (an alert's type).
					const [node] = view.own([i]);
					node.metadata = { ...(node.metadata ?? {}), ...metadata } as typeof node.metadata;
					return { op: 'noop' };
				},
				landing: () => {
					const caret = options?.caret;
					return caret ? scope.at(i, caret.path, caret.offset) : null;
				}
			});
		},

		async replaceRaw(i, raw, caret) {
			const node = scope.children()[i];
			if (!node) return false;
			const target = scope.target();
			const lineEnding = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
			const text = withLineEnding(raw, lineEnding);
			const write = legalizeWrite(target, i, text, 'literal', scope.reading.grammar);
			const kept = caret === undefined ? undefined : offsetThroughRewrite(node.raw, text, caret);
			// With no caret to keep, only a block that became new blocks takes one, at its start.
			const landed = await commitLeafText(scope, i, write, {
				snapshotOffset: caret ?? 0,
				caret: kept === undefined ? 0 : write.storedOffset(kept),
				landing: (written) =>
					kept !== undefined || written.replaced ? unlessFocusMoved(written) : null
			});
			return landed.wrote;
		},

		async replaceBlock(i, given, focus, options) {
			const children = scope.children();
			if (i < 0 || i >= children.length) return null;
			// A replacement is built before any content write sees it, so the container's body rule
			// is applied here, to every block in it.
			const target = scope.target();
			const owner = 'owner' in target ? target.owner : undefined;
			const lineEnding = 'lineEnding' in target ? target.lineEnding : documentLineEnding(target);
			const legal = normalizeReplacementForBody(owner, given, lineEnding, scope.reading.grammar);
			const atTaskStart = landAtTaskStart(owner, i, legal.replacement, scope.reading.grammar);
			const replacement = atTaskStart?.nodes ?? legal.replacement;
			const caret = focus && landedFocus(focus, legal.mapIndex, atTaskStart);
			const focusIndex = caret?.replacementIndex ?? 0;
			// The fix-up's merges can move where the caret belongs, so the commit keeps it updated.
			const tracked = caret
				? trackedPasteCaret(replacement, i, focusIndex, caret.offset)
				: undefined;
			const snapshot = { index: i, offset: options.snapshotOffset };
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
					const trivia = normalizeReplacementTrivia(old, replacement);
					for (const node of trivia) ensureEditableContainers(node, view.body.lineEnding);
					const normalized = closeWrittenOpeners(
						view.body,
						i,
						old.raw,
						trivia,
						scope.reading.grammar
					);
					const { children, owner } = view.body;
					const change = writeKeepingTaskMarker(owner, children, i, view.sharing, () => {
						spliceMany(children, i, 1, normalized);
						// The first id carries over only to a block of the same kind, whose component
						// the position keeps; another kind mounts a component of its own anyway.
						const replaced: StructuralChange =
							normalized[0].kind === old.kind
								? replacePreservingFirst(i, 1, normalized.length)
								: { op: 'replace', at: i, count: 1, newCount: normalized.length };
						stampStructuralChange(children, replaced, view.sharing);
						return replaced;
					});
					if (options?.trailingBlank) {
						landTrailingBlank(
							view.body,
							i + normalized.length,
							ownTrailingLineEnding(old.raw) !== ''
						);
					}
					return change;
				},
				landing: () => {
					if (!caret || !tracked || replacement.length === 0) return null;
					if (caret.path) return scope.at(i + focusIndex, caret.path, caret.offset);
					const at = landedPastePosition(scope.children()[tracked.index], tracked, caret.offset);
					return scope.at(tracked.index, at.path, at.offset);
				}
			});
			return wrote ? replacement.length : null;
		}
	};

	return core;
}
