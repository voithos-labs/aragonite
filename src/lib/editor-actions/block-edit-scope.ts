/**
 * What the shared block-edit core needs of one block list, the document root or a container.
 * The factories here are the only place the commit's document-absolute paths (`DocPath`) are
 * made; the core hands over local indices only, and a dev-mode check covers JS callers.
 */

import type { OpDescriptor, OperationKind } from '../schema/operations';
import { emitCommitError } from '../editor-events';
import type {
	CommitLanding,
	ContainerEditActions,
	ContainerScope,
	InPlaceResult,
	MultiScopeTarget,
	UndoGrouping
} from '../action-contracts';
import { blockNodeAt, type BodyParent } from '../tree-operations/node-primitives';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { TrackedPosition } from '../tree-operations/fix-up/apply';
import type { LegalWrite, WriteTarget } from '../tree-operations/content-write';
import type { Reading } from '../schema/reading';
import type { DocumentStamps } from './commit/document-stamp';
import type { CaretMemory } from '../caret/caret-memory';
import { containerScopeState } from '../tree-operations/paste/parent-scope';
import { asDocPath, type DocPath, docPathFrom, extendDocPath } from '../core/coordinate-spaces';
import type { CaretPosition } from '../selection/primitives';
import type { LandingOutcome, RevealPolicy } from '../selection/caret-landing';
import type { RemovalGesture } from '../selection/caret-target';
import { removeWholeBlock } from '../selection/cross-block/range-removal';
import { getStateForNode } from '../block-lists/state-registry';
import type { EditorActionsDeps, EditorRoot, UndoController } from './deps';
import type { NestedActionsDeps } from './nested/nested-actions';
import type { BlockListState } from '../block-lists/block-list-state.svelte';
import { createContainerEditActions } from './container-edit';

/** The copied children the core's `mutate` writes through, the same shape at both levels. */
export interface MutationView {
	/** The children this mutation writes and the container they belong to. */
	readonly body: BodyParent;
	readonly sharing: SharingState;
	/** The editor's reading, for mutations that re-parse and joins that clean up after themselves. */
	readonly reading: Reading;
	/** Tells the commit's fix-up what the mutation did beyond its splice; see `ContainerScope`. */
	describeEdit: ContainerScope['describeEdit'];
	own: ContainerScope['own'];
	writeLeaf: ContainerScope['writeLeaf'];
}

export interface ScopeCommitArgs {
	/** Where undo puts the caret back, as a local index in this list, when nothing is focused. */
	snapshot: { index: number; offset: number };
	/** Local index the edit event targets; the factory prefixes the scope's absolute path. */
	eventTarget: number;
	op: OpDescriptor;
	mutate: (view: MutationView) => StructuralChange;
	/** Where the caret goes, read after the commit; built with the scope's `at`. */
	landing?: CommitLanding;
	/** How far the landing moves the viewport; `'into-view'` when absent. */
	reveal?: RevealPolicy;
	/** A structural edit that can change nothing, so the commit discards its snapshot. Never on
	 *  content or metadata commits, whose `noop` still carries a byte change (`DiscardIfNoop`). */
	discardIfNoop?: boolean;
	/** `join-typing` for a keystroke's own commit, which joins the entry its `typeIn` pushed. */
	history?: UndoGrouping;
	/** A local position the list's fix-up updates in place, read back by the landing. */
	trackCaret?: TrackedPosition;
}

export interface CommitScope {
	/** This list's document path: empty at the root. */
	readonly path: DocPath;
	/** How the editor reads its bytes: the reading-mode check and the reparse grammar. */
	readonly reading: Reading;
	/** Which document the write being made was stamped with, for the write gate. */
	readonly stamps: DocumentStamps;
	/** How the caret arrived; a keystroke's write forgets it. */
	readonly caretMemory: Pick<CaretMemory, 'forget'>;
	/** Read only; mutation goes through the commit's copied view, never this. */
	children(): readonly NodeView[];
	/** The list as a write target before any write: its container and line ending, and at the
	 *  root the document with its trailing blank line. What the write rule and the trial read. */
	target(): WriteTarget;
	/** The id the typing batch keys on for child `i`. */
	idAt(i: number): string;
	/** Removes child `i` whole through the range-edit core, in one commit that names its snapshot
	 *  and edit event as `commit` does; the caret lands on the side `gesture` points. */
	removeWhole(
		i: number,
		gesture: RemovalGesture,
		args: Pick<ScopeCommitArgs, 'snapshot' | 'op'>
	): Promise<boolean>;
	/** An empty replaceBlock emits `delete` (container) or `replaceBlock{count:0}` (top-level). */
	collapseEmptyReplaceToDelete: boolean;
	/** Resolves to whether bytes landed. */
	commit(args: ScopeCommitArgs): Promise<boolean>;
	/** One keystroke into child `i`: its undo entry (`history` says whose) is pushed before `work`
	 *  starts, and what `work` commits before its first await joins it. */
	typeIn<T>(
		i: number,
		preEditOffset: number,
		history: UndoGrouping,
		work: () => Promise<T>
	): Promise<T>;
	/** The keystroke's in-place write, for a write the trial reparse keeps in its block. */
	typeLeaf(i: number, write: LegalWrite, caret: number): InPlaceResult;
	/** A position below child `i`. */
	at(i: number, subPath: readonly number[], offset: number): CaretPosition;
	/** Put the caret at `pos` through the editor's caret landing, for an edit with no commit. */
	land(pos: CaretPosition): Promise<LandingOutcome>;
	/** Report a write to child `i` that was refused before its commit to the `error` event. */
	reportCommitError(error: unknown, op: OperationKind, i: number): void;
}

// ── Top-level adapter ────────────────────────────────────────────────────────

export function createTopLevelScope(
	deps: EditorActionsDeps,
	controller: UndoController
): CommitScope {
	return {
		path: asDocPath([]),
		get reading() {
			return deps.reading;
		},
		stamps: deps.stamps,
		caretMemory: deps.caretMemory,
		children: () => deps.doc.children,
		target: () => deps.doc,
		idAt: (i) => deps.blockIds[i],
		removeWhole: (i, gesture, { snapshot, op }) =>
			removeWholeBlock({ bytes: deps.bytes, reading: deps.reading, controller }, [i], gesture, {
				snapshot: { path: asDocPath([snapshot.index]), offset: snapshot.offset },
				op: { ...op, eventPath: asDocPath([i]) }
			}),
		collapseEmptyReplaceToDelete: false,
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			landing,
			reveal,
			discardIfNoop,
			history,
			trackCaret
		}): Promise<boolean> {
			return controller.commitStructural({
				snapshot: { path: asDocPath([snapshot.index]), offset: snapshot.offset },
				mutate: (_, docScope) =>
					mutate({
						body: docScope.body,
						sharing: deps.sharing,
						reading: deps.reading,
						describeEdit: docScope.describeEdit,
						own: docScope.own,
						writeLeaf: docScope.writeLeaf
					}),
				op: { ...op, eventPath: asDocPath([eventTarget]) },
				landing,
				reveal,
				discardIfNoop,
				history,
				trackCaret
			});
		},
		typeIn: (i, preEditOffset, history, work) =>
			controller.typingKeystroke(docPathFrom([i]), preEditOffset, deps.blockIds[i], history, work),
		typeLeaf: (i, write, caret) => controller.typeLeaf(docPathFrom([i]), write, caret),
		at: (i, subPath, offset) => ({ path: docPathFrom([i, ...subPath]), offset }),
		land: (pos) => deps.caretLanding.land(pos),
		reportCommitError: (error, op, i) => emitCommitError(deps.events, { error, op, path: [i] })
	};
}

// ── Container adapter ────────────────────────────────────────────────────────

/** What a container's scope reads, from a mounted container or from a path. */
interface ContainerParts {
	/** Live: a commit replaces the node and can move it. */
	node(): NodeView;
	path(): number[];
	state: MultiScopeTarget['state'];
	reading(): Reading;
	stamps: DocumentStamps;
	caretMemory: Pick<CaretMemory, 'forget'>;
	containerEdit: ContainerEditActions;
}

export function createContainerScope(state: BlockListState, deps: NestedActionsDeps): CommitScope {
	return containerScope({
		node: () => deps.node,
		path: () => deps.path,
		state,
		reading: () => deps.reading,
		stamps: deps.stamps,
		caretMemory: deps.caretMemory,
		containerEdit: deps.parent.containerEdit
	});
}

/** The list at `parentPath` (the root's at `[]`), null where no container stands; build it after a
 *  gesture's earlier commit. */
export function createPathScope(root: EditorRoot, parentPath: DocPath): CommitScope | null {
	const { deps, controller } = root;
	if (parentPath.length === 0) return createTopLevelScope(deps, controller);
	const node = blockNodeAt(deps.doc, parentPath);
	if (!node?.children) return null;
	return containerScope({
		node: () => blockNodeAt(deps.doc, parentPath) ?? node,
		path: () => parentPath,
		state: containerScopeState({ resolveState: getStateForNode }, node),
		reading: () => deps.reading,
		stamps: deps.stamps,
		caretMemory: deps.caretMemory,
		containerEdit: createContainerEditActions(deps, controller)
	});
}

function containerScope(parts: ContainerParts): CommitScope {
	return {
		get path() {
			return docPathFrom(parts.path());
		},
		get reading() {
			return parts.reading();
		},
		stamps: parts.stamps,
		caretMemory: parts.caretMemory,
		// A collapse at this container's own index detaches it (`tree-operations/chain-rebuild.ts`),
		// so a post-commit read can find the container gone rather than merely empty.
		children: () => parts.node()?.children ?? [],
		target: () => ({
			children: parts.node()?.children ?? [],
			owner: parts.node(),
			lineEnding: parts.containerEdit.lineEnding()
		}),
		idAt: (i) => parts.state.innerBlockIds[i],
		removeWhole: (i, gesture, { snapshot, op }) =>
			parts.containerEdit.removeWhole(extendDocPath(parts.path(), i), gesture, {
				snapshot: { path: extendDocPath(parts.path(), snapshot.index), offset: snapshot.offset },
				op: { ...op, eventPath: extendDocPath(parts.path(), i) }
			}),
		collapseEmptyReplaceToDelete: true,
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			landing,
			reveal,
			discardIfNoop,
			history,
			trackCaret
		}): Promise<boolean> {
			return parts.containerEdit.commitContainer({
				containerNode: parts.node(),
				path: parts.path(),
				state: parts.state,
				snapshot: { path: extendDocPath(parts.path(), snapshot.index), offset: snapshot.offset },
				mutate: (view) =>
					mutate({
						body: view.body,
						sharing: view.sharing,
						reading: parts.reading(),
						describeEdit: view.describeEdit,
						own: view.own,
						writeLeaf: view.writeLeaf
					}),
				op: { ...op, eventPath: extendDocPath(parts.path(), eventTarget) },
				landing,
				reveal,
				discardIfNoop,
				history,
				trackCaret
			});
		},
		typeIn: (i, preEditOffset, history, work) =>
			parts.containerEdit.typingKeystroke(
				extendDocPath(parts.path(), i),
				preEditOffset,
				parts.state.innerBlockIds[i],
				history,
				work
			),
		typeLeaf: (i, write, caret) =>
			parts.containerEdit.typeLeaf(extendDocPath(parts.path(), i), write, caret),
		at: (i, subPath, offset) => ({ path: docPathFrom([...parts.path(), i, ...subPath]), offset }),
		// Through the editor root rather than this list's refs: a write that changed this
		// container's kind replaced its component, and its refs with it.
		land: (pos) => parts.containerEdit.land(pos),
		reportCommitError: (error, op, i) =>
			parts.containerEdit.reportCommitError(error, op, extendDocPath(parts.path(), i))
	};
}
