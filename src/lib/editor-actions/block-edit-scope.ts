/**
 * What the shared block-edit core needs of one block list, the document root or a container.
 * The factories here are the only place the commit's document-absolute paths (`DocPath`) are
 * made; the core hands over local indices only, and a dev-mode check covers JS callers.
 */

import type { OpDescriptor } from '../schema/operations';
import type {
	CommitAfterTick,
	ContainerEditActions,
	InPlaceResult,
	MultiScopeTarget
} from '../action-contracts';
import { blockNodeAt, documentBody, type BodyParent } from '../tree-operations/node-primitives';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { StructuralChange } from '../tree-operations/structural-change';
import type { SharingState } from '../tree-operations/sharing';
import type { LegalWrite, WriteTarget } from '../tree-operations/content-write';
import type { Reading } from '../schema/reading';
import type { BlockComponent } from '../block-component';
import type { CaretMemory } from '../cursor/caret-memory';
import { ensureUnsharedPath, ensureUnsharedChild } from '../tree-operations';
import { containerScopeState } from '../tree-operations/paste/parent-scope';
import { asDocPath, type DocPath } from '../selection/path-math';
import type { CaretPosition } from '../selection/primitives';
import { caretTargetFor, type CaretTarget } from '../selection/caret-target';
import { docPathFrom, extendDocPath } from '../cursor/coordinate-spaces';
import { getStateForNode } from '../reactivity/state-registry';
import type { EditorActionsDeps, UndoController } from './deps';
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
	/** Filled by `mutate` for the dev-mode stale-raw check when it returns `noop`; only the root
	 *  reads them, since a container's commit checks its whole copied container. */
	touchedNodes?: CstNode[];
	/**
	 * A structural edit that can legitimately change nothing, so the commit discards the
	 * snapshot rather than push a dead entry. Never on content or metadata commits: their
	 * `noop` still carries a byte change (action-contracts `DiscardIfNoop`).
	 */
	discardIfNoop?: boolean;
}

export interface CommitScope {
	/** This list's document path: empty at the root. */
	readonly path: DocPath;
	/** How the editor reads its bytes: the reading-mode check and the reparse grammar. */
	readonly reading: Reading;
	/** How the caret arrived; a keystroke's write forgets it. */
	readonly caretMemory: Pick<CaretMemory, 'forget'>;
	/** Read only; mutation goes through the commit's copied view, never this. */
	children(): readonly NodeView[];
	/** The list as a write target before any write: its container and line ending, and at the
	 *  root the document with its trailing blank line. What the write rule and the trial read. */
	target(): WriteTarget;
	/** The id the typing batch keys on for child `i`. */
	idAt(i: number): string;
	refAt(i: number): BlockComponent | undefined;
	/** Mount the block at `path` below child `index`, scrolling it into the render window and
	 *  waiting at each level; null when it cannot be mounted. */
	reveal(index: number, path: readonly number[]): Promise<BlockComponent | null>;
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
	/** Put the caret at `pos`, a block of this list or a leaf anywhere: resolve it to a leaf,
	 *  mount it, focus it. */
	land(pos: CaretPosition): Promise<void>;
}

/**
 * Put the caret at `path` below child `index`, mounting that block first: a write can move the
 * caret into a block the render window has not drawn yet.
 */
export async function landCaretInScope(
	scope: CommitScope,
	index: number,
	path: readonly number[],
	offset: number
): Promise<void> {
	await scope.reveal(index, path);
	const ref = scope.refAt(index);
	if (path.length === 0) ref?.focus(offset);
	else ref?.focusByPath?.([...path], offset);
}

// ── Top-level adapter ────────────────────────────────────────────────────────

export function createTopLevelScope(
	deps: EditorActionsDeps,
	controller: UndoController
): CommitScope {
	const typing = createLeafTyping(deps, controller);
	const scope: CommitScope = {
		path: asDocPath([]),
		get reading() {
			return deps.reading;
		},
		caretMemory: deps.caretMemory,
		children: () => deps.doc.children,
		target: () => deps.doc,
		idAt: (i) => deps.blockIds[i],
		refAt: (i) => deps.blockRefs[i],
		reveal: (index, path) => deps.revealPath([index, ...path]),
		collapseEmptyReplaceToDelete: false,
		commit({
			snapshot,
			eventTarget,
			op,
			mutate,
			afterTick,
			touchedNodes,
			discardIfNoop
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
				touchedNodes,
				discardIfNoop
			});
		},
		typeIn: (i, preEditOffset, work) =>
			typing.typeInLeaf(docPathFrom([i]), preEditOffset, deps.blockIds[i], work),
		writeInPlace: (i, write, caret) => typing.writeLeafInPlace(docPathFrom([i]), write, caret),
		at: (i, subPath, offset) => ({ path: docPathFrom([i, ...subPath]), offset }),
		async land(pos) {
			const leaf = caretTargetFor(deps.doc, pos) ?? asTarget(pos);
			await landCaretInScope(scope, leaf.leafPath[0], leaf.leafPath.slice(1), leaf.offset);
		}
	};
	return scope;
}

// ── Container adapter ────────────────────────────────────────────────────────

/** What a container's scope reads, from a mounted container or from a path. */
interface ContainerParts {
	/** Live: a commit replaces the node and can move it. */
	node(): NodeView;
	path(): number[];
	state: MultiScopeTarget['state'];
	reading(): Reading;
	caretMemory: Pick<CaretMemory, 'forget'>;
	containerEdit: ContainerEditActions;
	/** The editor's own descent to a block by its document path. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
}

export function createContainerScope(state: BlockListState, deps: NestedActionsDeps): CommitScope {
	return containerScope({
		node: () => deps.node,
		path: () => deps.path,
		state,
		reading: () => deps.reading,
		caretMemory: deps.caretMemory,
		containerEdit: deps.parent.containerEdit,
		revealPath: (path) => deps.parent.focus.revealPath(path)
	});
}

/** The scope of the list at `parentPath`: the root's at the empty path, null where no container
 *  stands. Build it after any earlier commit of the gesture, which may replace the container. */
export function createPathScope(
	root: { deps: EditorActionsDeps; controller: UndoController },
	parentPath: DocPath
): CommitScope | null {
	const { deps, controller } = root;
	if (parentPath.length === 0) return createTopLevelScope(deps, controller);
	const node = blockNodeAt(deps.doc, parentPath);
	if (!node?.children) return null;
	return containerScope({
		node: () => blockNodeAt(deps.doc, parentPath) ?? node,
		path: () => parentPath,
		state: containerScopeState({ resolveState: getStateForNode }, node),
		reading: () => deps.reading,
		caretMemory: deps.caretMemory,
		containerEdit: createContainerEditActions(deps, controller),
		revealPath: deps.revealPath
	});
}

function containerScope(parts: ContainerParts): CommitScope {
	const scope: CommitScope = {
		get path() {
			return docPathFrom(parts.path());
		},
		get reading() {
			return parts.reading();
		},
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
		refAt: (i) => parts.state.innerBlockRefs[i],
		reveal: (index, path) => parts.revealPath([...parts.path(), index, ...path]),
		collapseEmptyReplaceToDelete: true,
		commit({ snapshot, eventTarget, op, mutate, afterTick, discardIfNoop }): Promise<boolean> {
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
				discardIfNoop
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
		async land(pos) {
			const leaf = leafBelow(parts, pos) ?? asTarget(pos);
			// Through the editor's own descent rather than this list's refs: a write that changed
			// this container's kind replaced its component, and its refs with it.
			(await parts.revealPath([...leaf.leafPath]))?.focus(leaf.offset);
		}
	};
	return scope;
}

/** `pos` resolved over this container's children when it names one of them; null otherwise, and
 *  a position outside this list then already names a leaf the root resolved. */
function leafBelow(parts: ContainerParts, pos: CaretPosition): CaretTarget | null {
	const base = parts.path();
	if (pos.path.length <= base.length || base.some((index, k) => pos.path[k] !== index)) return null;
	const children = parts.node()?.children;
	if (!children) return null;
	const list = { kind: 'document' as const, prefix: '', children, suffix: '' };
	const local = caretTargetFor(list, {
		path: docPathFrom(pos.path.slice(base.length)),
		offset: pos.offset
	});
	return local && { leafPath: docPathFrom([...base, ...local.leafPath]), offset: local.offset };
}

const asTarget = (pos: CaretPosition): CaretTarget => ({ leafPath: pos.path, offset: pos.offset });
