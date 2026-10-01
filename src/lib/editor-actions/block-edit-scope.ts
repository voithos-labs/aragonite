/**
 * What the shared block-edit core needs of one block list, the document root or a container.
 * The factories here are the only place the commit's document-absolute paths (`DocPath`) are
 * made; the core hands over local indices only, and a dev-mode check covers JS callers.
 */

import type { OpDescriptor } from '../schema/operations';
import type {
	CommitAfterTick,
	CommitLanding,
	ContainerEditActions,
	InPlaceResult,
	MultiScopeTarget
} from '../action-contracts';
import { blockNodeAt, documentBody, type BodyParent } from '../tree-operations/node-primitives';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { TrackedPosition } from '../tree-operations/settle';
import type { LegalWrite, WriteTarget } from '../tree-operations/content-write';
import type { Reading } from '../schema/reading';
import type { DocumentStamps } from './commit/document-stamp';
import type { CaretMemory } from '../cursor/caret-memory';
import { ensureUnsharedPath, ensureUnsharedChild } from '../tree-operations';
import { containerScopeState } from '../tree-operations/paste/parent-scope';
import { asDocPath, type DocPath } from '../selection/path-math';
import type { CaretPosition } from '../selection/primitives';
import type { LandingOutcome, RevealPolicy } from '../selection/caret-landing';
import { survivorAfterRemoval, type RemovalGesture } from '../selection/caret-target';
import { docPathFrom, extendDocPath } from '../cursor/coordinate-spaces';
import { getStateForNode } from '../reactivity/state-registry';
import type { EditorActionsDeps, EditorRoot, UndoController } from './deps';
import type { NestedActionsDeps } from './nested/nested-actions';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { createLeafTyping } from './leaf-write';
import { createContainerEditActions } from './container-edit';

/** The copied children the core's `mutate` writes through, the same shape at both levels. */
export interface MutationView {
	/** The children this mutation writes and the container they belong to. */
	readonly body: BodyParent;
	readonly sharing: SharingState;
	/** The editor's reading, for mutations that re-parse and joins that clean up after themselves. */
	readonly reading: Reading;
	/** Copy the child at `i` out of the undo snapshot before an in-place write; returns the copy. */
	unshareChild(i: number): CstNode;
}

export interface ScopeCommitArgs {
	/** Where undo puts the caret back, as a local index in this list, when nothing is focused. */
	snapshot: { index: number; offset: number };
	/** Local index the edit event targets; the factory prefixes the scope's absolute path. */
	eventTarget: number;
	op: OpDescriptor;
	mutate: (view: MutationView) => StructuralChange;
	afterTick?: CommitAfterTick;
	/** Where the caret goes, read after the commit; built with the scope's `at`. */
	landing?: CommitLanding;
	/** How far the landing moves the viewport; `'into-view'` when absent. */
	reveal?: RevealPolicy;
	/** Filled by `mutate` for the dev-mode stale-raw check when it returns `noop`; only the root
	 *  reads them, since a container's commit checks its whole copied container. */
	touchedNodes?: CstNode[];
	/** A structural edit that can change nothing, so the commit discards its snapshot. Never on
	 *  content or metadata commits, whose `noop` still carries a byte change (`DiscardIfNoop`). */
	discardIfNoop?: boolean;
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
	/** Where the caret goes once child `i` is gone, read after the commit that removed it. */
	survivor(i: number, gesture: RemovalGesture): CaretPosition | null;
	/** An empty replaceBlock emits `delete` (container) or `replaceBlock{count:0}` (top-level). */
	collapseEmptyReplaceToDelete: boolean;
	/** Resolves to whether bytes landed. */
	commit(args: ScopeCommitArgs): Promise<boolean>;
	/** One keystroke into child `i`, grouped with its typing burst: the burst's undo entry is on
	 *  the stack before `work` starts, and whatever `work` commits before it first yields joins it. */
	typeIn<T>(i: number, preEditOffset: number, work: () => Promise<T>): Promise<T>;
	/** The keystroke's in-place write, for a write the trial reparse keeps in its block. */
	writeInPlace(i: number, write: LegalWrite, caret: number): InPlaceResult;
	/** A position below child `i`. */
	at(i: number, subPath: readonly number[], offset: number): CaretPosition;
	/** Put the caret at `pos` through the editor's caret landing, for an edit with no commit. */
	land(pos: CaretPosition): Promise<LandingOutcome>;
}

// ── Top-level adapter ────────────────────────────────────────────────────────

export function createTopLevelScope(
	deps: EditorActionsDeps,
	controller: UndoController
): CommitScope {
	const typing = createLeafTyping(deps, controller);
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
		survivor: (i, gesture) => survivorAfterRemoval(deps.doc, [i], gesture),
		collapseEmptyReplaceToDelete: false,
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			afterTick,
			landing,
			reveal,
			touchedNodes,
			discardIfNoop,
			trackCaret
		}): Promise<boolean> {
			return controller.commitStructural({
				snapshot: { path: asDocPath([snapshot.index]), offset: snapshot.offset },
				mutate: (children) =>
					mutate({
						body: documentBody(deps.doc, children),
						sharing: deps.sharing,
						reading: deps.reading,
						unshareChild: (i) => ensureUnsharedPath({ children }, [i], deps.sharing)[0]
					}),
				op: { ...op, eventPath: asDocPath([eventTarget]) },
				afterTick,
				landing,
				reveal,
				touchedNodes,
				discardIfNoop,
				trackCaret
			});
		},
		typeIn: (i, preEditOffset, work) =>
			typing.typeInLeaf(docPathFrom([i]), preEditOffset, deps.blockIds[i], work),
		writeInPlace: (i, write, caret) => typing.writeLeafInPlace(docPathFrom([i]), write, caret),
		at: (i, subPath, offset) => ({ path: docPathFrom([i, ...subPath]), offset }),
		land: (pos) => deps.caretLanding.land(pos)
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
		survivor: (i, gesture) =>
			parts.containerEdit.survivorAfterRemoval(extendDocPath(parts.path(), i), gesture),
		collapseEmptyReplaceToDelete: true,
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			afterTick,
			landing,
			reveal,
			discardIfNoop,
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
						unshareChild: (i) => ensureUnsharedChild(view.node, i, view.sharing)
					}),
				op: { ...op, eventPath: extendDocPath(parts.path(), eventTarget) },
				afterTick,
				landing,
				reveal,
				discardIfNoop,
				trackCaret
			});
		},
		typeIn: (i, preEditOffset, work) =>
			parts.containerEdit.typeInLeaf(
				extendDocPath(parts.path(), i),
				preEditOffset,
				parts.state.innerBlockIds[i],
				work
			),
		writeInPlace: (i, write, caret) =>
			parts.containerEdit.writeLeafInPlace(extendDocPath(parts.path(), i), write, caret),
		at: (i, subPath, offset) => ({ path: docPathFrom([...parts.path(), i, ...subPath]), offset }),
		// Through the editor root rather than this list's refs: a write that changed this
		// container's kind replaced its component, and its refs with it.
		land: (pos) => parts.containerEdit.land(pos)
	};
}
