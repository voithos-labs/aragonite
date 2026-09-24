/**
 * The commit sequence (`runCommitCeremony`): undo snapshot, copy before write, mutate,
 * rollback on failure. Owns G1.9: a node shared with an undo snapshot is read-only until
 * the commit copies it. Keystroke batching is in text-batch.ts.
 */

import { DEV } from 'esm-env';
import { tick } from 'svelte';
import type { BlockComponent } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { EditorSelection } from '../../selection/primitives';
import type { GapCaretSelection, UndoEntry } from '../../undo/types';
import type { SelectionPoint } from '../../selection/primitives';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { readCurrentSelection } from '../../selection/native-bridge';
import { asDocPath, pathsEqual } from '../../selection/path-math';
import { assertInvariant } from '../../assert';
import { beginCommit, endCommit } from '../../invariants/commit-scope';
import { assignIds } from '../../block-id';
import { replaceRefs } from '../../reactivity/publish-ref.svelte';
import { nodeAt, type SeparatorParent } from '../../tree-operations/node-primitives';
import { settleSeparator } from '../../tree-operations/settle';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import {
	attachedChainPrefix,
	rebuildUnsharedChain,
	type AncestrySeamFold,
	type ContainerReclassification
} from '../../tree-operations/chain-rebuild';
import { foldLandingFor, publishAncestryFolds, type FoldLanding } from '../ancestry-folds';
import { createTextBatch } from './text-batch';
import type { EditorActionsDeps, UndoController } from '../deps';
import type {
	CommitAfterTick,
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	CommitSnapshotArg,
	CommitStructuralArgs,
	ContainerScope,
	MultiScopeTarget
} from '../../action-contracts';
import type { ScopedOpDescriptor } from '../../schema/operations';
import { toEditEvent } from '../../editor-events';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../../tree-operations/structural-change';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import {
	assertCommitPaths,
	assertCommittedNodes,
	assertIdsInLockstep,
	assertUndoTopIntegrity
} from '../../invariants/install';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import { dropChildSpans } from '../../schema/child-spans';
import {
	docByteLength,
	perfEnabled,
	recordSnapshotClone,
	setUndoGauge
} from '../../perf/instruments';

// ── Dev invariant scoping (DEV-only paths) ────────────────────────────────────

/** A `noop` change names no new positions, so the caller passes its leaf via `explicit`. */
function touchedFromChange(
	change: StructuralChange,
	children: CstNode[],
	explicit: CstNode[] | undefined
): CstNode[] {
	if (change.op === 'insert') return children.slice(change.at, change.at + change.count);
	if (change.op === 'replace') return children.slice(change.at, change.at + change.newCount);
	return explicit ?? [];
}

/** Direct children go along: a container's rebuild concatenates them into its raw. */
function touchedContainersWithChildren(containers: CstNode[] | undefined): CstNode[] {
	if (!containers) return [];
	const out: CstNode[] = [];
	for (const c of containers) {
		out.push(c);
		// Appended, never spread: a giant table's row list outnumbers an argument list (G4.60).
		for (const child of c.children ?? []) out.push(child);
	}
	return out;
}

export function createUndoController(deps: EditorActionsDeps): UndoController {
	// ── Selection helpers ─────────────────────────────────────────────────────

	/**
	 * The document as the blank-line fix-up's parent, over the mutate's working array. The
	 * suffix goes as accessors: a fix-up at the end consumes the trailing blank line the
	 * live document keeps in its suffix, and the rollback restores it.
	 */
	function docSettleParent(children: CstNode[]): SeparatorParent {
		return {
			kind: 'document',
			children,
			get suffix() {
				return deps.doc.suffix;
			},
			set suffix(value: string) {
				deps.doc.suffix = value;
			}
		};
	}

	function collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection {
		const point: SelectionPoint = { path: [blockIndex], offset };
		return { anchor: point, focus: point };
	}

	function collapsedSelectionAtPath(path: number[], offset: number): EditorSelection {
		const point: SelectionPoint = { path: path.slice(), offset };
		return { anchor: point, focus: point };
	}

	// ── Snapshot pushers ─────────────────────────────────────────────────────

	/**
	 * Snapshots share the live tree's nodes; only the top-level children array is copied.
	 * G1.9: an edit copies the path it writes first (`tree-operations/unshare.ts`).
	 */
	function shareSnapshot(): Pick<UndoEntry, 'snapshot' | 'integrity'> {
		deps.sharing.markSnapshotTaken();
		const snapshot: Document = {
			kind: 'document',
			prefix: deps.doc.prefix,
			children: [...deps.doc.children],
			suffix: deps.doc.suffix
		};
		return { snapshot, integrity: DEV ? digestDoc(snapshot) : undefined };
	}

	function recordSnapshotPerf(): void {
		if (!perfEnabled()) return;
		recordSnapshotClone(docByteLength(deps.doc));
		const undo = deps.undoManager.getStacks().undo;
		let liveBytes = 0;
		for (const entry of undo) liveBytes += docByteLength(entry.snapshot);
		setUndoGauge(liveBytes, undo.length);
	}

	/**
	 * What an entry records as "where the caret was". A selected image comes first: the browser
	 * puts a caret back in its paragraph that the editor drops a moment later, so a live read
	 * then names the paragraph start. The gap caret outranks only the caller's fallback, since
	 * no block ref reports it.
	 */
	function entrySelection(fallback: () => EditorSelection): EditorSelection | GapCaretSelection {
		const beforeImage = deps.getSelectedWidgetCaret?.();
		if (beforeImage) return beforeImage;
		const live = readCurrentSelection(deps.selectionState, deps.blockRefs);
		if (live) return live;
		const gap = deps.selectionState.gapCaret;
		return gap ? { gapCaret: gap } : fallback();
	}

	function pushUndoSnapshotPath(fallbackPath: number[], offset: number): void {
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection: entrySelection(() => collapsedSelectionAtPath(fallbackPath, offset))
		});
		recordSnapshotPerf();
	}

	// Top-level only: a caller with a deeper path must use pushUndoSnapshotPath, or its
	// no-caret fallback restores to the top-level block instead of the edited leaf.
	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		pushUndoSnapshotPath([blockIndex], offset);
	}

	// Path from the live focused leaf, offset from the caller: the live caret is already
	// past the edit, but its path still points at the same leaf.
	function pushTypingSnapshot(leafPath: number[], offset: number): void {
		const live = readCurrentSelection(deps.selectionState, deps.blockRefs);
		const liveIsCollapsed =
			!!live &&
			pathsEqual(live.anchor.path, live.focus.path) &&
			live.anchor.offset === live.focus.offset;
		const selection = liveIsCollapsed
			? collapsedSelectionAtPath(live.anchor.path, offset)
			: collapsedSelectionAtPath(leafPath, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
	}

	const textBatch = createTextBatch({
		pushSnapshot: pushTypingSnapshot,
		emitInput: (leafPath, byteLength) =>
			deps.events.emit('edit', {
				op: 'input',
				path: leafPath,
				detail: { byteLength },
				timestamp: Date.now()
			})
	});

	// ── Internal commit primitive ────────────────────────────────────────────

	type CommitArgs =
		| {
				kind: 'document';
				snapshot: CommitSnapshotArg;
				/** The commit syncs ids and refs from the returned change; never splice them here. */
				mutate: (children: CstNode[]) => StructuralChange;
				publish: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void;
				op?: ScopedOpDescriptor;
				afterTick?: CommitAfterTick;
				/** Nodes for the dev check when the change names none (an in-place `op: 'noop'`). */
				touchedNodes?: CstNode[];
				discardIfNoop?: boolean;
		  }
		| {
				kind: 'container';
				snapshot: CommitSnapshotArg;
				/** False when every scope changed nothing. The callbacks copy and write their own scopes. */
				mutate: () => boolean;
				publish: () => void;
				op?: ScopedOpDescriptor;
				afterTick?: CommitAfterTick;
				/** A function, since the copied nodes only exist once `mutate` has made them. */
				touchedNodes?: () => CstNode[];
				/**
				 * Restores in-place splices into nodes already copied in this undo entry,
				 * which the top-level array swap cannot reach.
				 */
				rollback?: () => void;
				discardIfNoop?: boolean;
		  };

	interface RollbackFrame {
		restore(): void;
	}

	/**
	 * Everything a commit that throws, or bails on discardIfNoop, restores, in one place.
	 * A container's per-scope state does not exist until `mutate` has copied it, so restore()
	 * hands those to the `rollback` function.
	 */
	function captureRollbackFrame(args: CommitArgs): RollbackFrame {
		// A whole-stack restore, not a pop: the push may evict the oldest entry at the cap.
		const savedStacks = args.snapshot !== 'skip' ? deps.undoManager.getStacks() : null;
		// The container branch mutates the live tree in place; the document branch installs
		// its children only on success, but its trailing-line fix-up can consume the live
		// document's suffix, so the suffix is restored in both branches.
		const savedDocChildren = args.kind === 'container' ? [...deps.doc.children] : null;
		const savedDocSuffix = deps.doc.suffix;
		return {
			restore() {
				// Top down: the stacks, the top-level array, then the function for the in-place
				// splices the array swap cannot reach.
				if (savedStacks) deps.undoManager.restoreStacks(savedStacks);
				if (savedDocChildren) deps.doc.children = savedDocChildren;
				deps.doc.suffix = savedDocSuffix;
				if (args.kind === 'container') args.rollback?.();
			}
		};
	}

	/** The one path to the `error` event, so every throw site reports alike (editor.md §12). */
	function reportCommitError(args: CommitArgs, error: unknown): void {
		deps.events.emit('error', {
			origin: 'commit',
			error,
			context: { op: args.op?.kind, path: args.op?.eventPath }
		});
	}

	function runCommitCeremony(args: CommitArgs): boolean {
		deps.stickyColumn.reset();
		deps.edgeAffinity.reset();
		textBatch.interrupt();

		if (DEV) {
			// Both declared paths must be document-absolute; `invariants` imports nothing at
			// runtime, so the number[] to DocPath conversion lives here.
			assertCommitPaths(
				deps.doc,
				args.snapshot === 'skip' ? null : asDocPath(args.snapshot.path),
				args.op?.eventPath ? asDocPath(args.op.eventPath) : null
			);
		}

		// Outside the try: the stacks must be saved before the push below.
		const rollback = captureRollbackFrame(args);

		// A `discardIfNoop` commit that changed nothing takes the throw path's restore minus
		// the error event. afterTick still runs.
		let discarded = false;
		try {
			if (args.snapshot !== 'skip') {
				// Inside the try: readCurrentSelection walks live block refs, plugin leaves
				// included, so it can throw like every other step.
				pushUndoSnapshotPath(args.snapshot.path, args.snapshot.offset);
			}
			if (args.kind === 'document') {
				const childrenCopy = [...deps.doc.children];
				const idsCopy = [...deps.blockIds];
				const refsCopy = [...deps.blockRefs];

				// `deps.doc.children` is still the pre-mutate array here (`publish` swaps it),
				// so the blank-line fix-up reads which blocks were blank off it directly.
				const change = settleSeparator(
					docSettleParent(childrenCopy),
					deps.doc.children,
					args.mutate(childrenCopy),
					deps.sharing,
					undefined,
					deps.grammar
				);
				if (args.discardIfNoop && change.op === 'noop') {
					// The document branch installed nothing; only the stacks are restored here.
					rollback.restore();
					discarded = true;
				} else {
					applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);
					assertIdsInLockstep('commitStructural', idsCopy.length, childrenCopy.length);
					args.publish(childrenCopy, idsCopy, refsCopy);
					if (DEV) {
						assertCommittedNodes(
							touchedFromChange(change, childrenCopy, args.touchedNodes),
							deps.grammar
						);
					}
				}
			} else {
				const changed = args.mutate();
				if (args.discardIfNoop && !changed) {
					// The in-place mutation ran but no scope changed: unwind as a throw would.
					rollback.restore();
					discarded = true;
				} else {
					args.publish();
					if (DEV) {
						assertCommittedNodes(
							touchedContainersWithChildren(args.touchedNodes?.()),
							deps.grammar
						);
					}
				}
			}
			if (!discarded && DEV) {
				// G1.9: a missed copy before write corrupts the newest undo entry, so catch it at
				// the commit, not at some distant undo. Never throws.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		} catch (err) {
			rollback.restore();
			reportCommitError(args, err);
			// Loud in dev; production swallows it so one failed edit does not kill the editor.
			// The tree is intact either way: rolled back, or never installed.
			if (DEV) throw err;
			return false;
		}

		if (!discarded) {
			// After both branches have installed their result, so nothing can cache the new
			// version against a half-installed tree. A discarded commit rolled its own mutation
			// back, and announcing it would claim bytes that never moved.
			deps.bumpContentVersion();
			// The gap caret names a boundary index, and a commit moves what that index names.
			// Ended here rather than remapped: nothing can say which boundary the user meant
			// afterwards. After the push above, so the entry this commit stored keeps the gap.
			deps.selectionState.clearGapCaret();
		}

		if (!discarded && args.op) {
			deps.events.emit('edit', toEditEvent(args.op, args.op.eventPath, Date.now()));
		}

		return true;
	}

	// Bracket the synchronous commit so the decorations never read a half-applied tree.
	// Cleared before the first await.
	async function __commit(args: CommitArgs): Promise<void> {
		beginCommit();
		let committed: boolean;
		try {
			committed = runCommitCeremony(args);
		} finally {
			endCommit();
		}
		if (!committed) return;
		await tick();
		try {
			// Awaited: a caret placement that scrolls an unmounted target into view is async,
			// and this promise is what every caller treats as "the caret is placed".
			await args.afterTick?.();
		} catch (err) {
			// No rollback: the commit succeeded and the tree is correct. Caught so a plugin's
			// afterTick is a reported no-op, not an unhandled rejection.
			reportCommitError(args, err);
		}
	}

	// ── Structural-mutation commit ───────────────────────────────────────────
	/** `snapshot: 'skip'` lets composite operations share a single undo entry. */

	async function commitStructural(args: CommitStructuralArgs): Promise<void> {
		const { snapshot, mutate, op, afterTick, touchedNodes, discardIfNoop } = args;
		await __commit({
			kind: 'document',
			snapshot,
			mutate,
			publish: (children, ids, refs) => {
				deps.doc.children = children;
				deps.setBlockIds(ids);
				deps.setBlockRefs(refs);
			},
			op,
			afterTick,
			touchedNodes,
			discardIfNoop
		});
	}

	async function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void> {
		const { containerNode, path, state, snapshot, mutate, op, afterTick, discardIfNoop } = args;
		await commitMultiScope({
			scopes: [{ node: containerNode, state, path }],
			snapshot,
			mutate: ([scope]) => [mutate(scope)],
			op,
			afterTick,
			discardIfNoop
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

	interface PreparedScope {
		target: MultiScopeTarget;
		isDoc: boolean;
		chain: CstNode[];
		owned: CstNode;
		view: ContainerScope;
		ids: string[];
		refs: (BlockComponent | undefined)[];
		/** The arrays before the swap: what rollback restores when mutate spliced in place. */
		savedChildren: CstNode[] | undefined;
		savedChildIds: string[] | undefined;
		/** publishScopeView writes the mutated ids and refs before the ancestor rebuild can throw. */
		savedStateIds: string[];
		savedStateRefs: (BlockComponent | undefined)[];
		/** The bytes before mutate; without them `serialize()` emits a half-applied document. */
		savedRaws: SavedRaw[];
	}

	interface SavedRaw {
		node: CstNode;
		raw: string;
	}

	/** The bytes at risk: the copied ancestors plus direct children, matching `savedChildren`. */
	function captureScopeRaws(chain: CstNode[], owned: CstNode): SavedRaw[] {
		const saved: SavedRaw[] = chain.map((node) => ({ node, raw: node.raw }));
		for (const child of owned.children ?? []) saved.push({ node: child, raw: child.raw });
		return saved;
	}

	/**
	 * Runs over all scopes before any is copied: preparing an earlier scope copies nodes a
	 * later, overlapping scope still points at.
	 */
	function assertScopeIdentity(s: MultiScopeTarget): void {
		if ((s.node as unknown) === (deps.doc as unknown)) return;
		// A stale path that is still in range would copy and rebuild the wrong ancestors.
		assertInvariant('multi-scope-commit-path', () =>
			nodeAt(deps.doc, s.path) === s.node
				? null
				: {
						code: 'multi-scope-commit-path',
						message: `commit: path [${s.path.join(',')}] does not resolve to scope node (${s.node.kind})`
					}
		);
	}

	/** Copies the scope's ancestors and attaches a working children array (`tree-operations/unshare.ts`). */
	function prepareScopeView(s: MultiScopeTarget): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		if (!isDoc && chain.length !== s.path.length) {
			// Falling back to the caller's still-shared node would silently corrupt the undo
			// entry sharing it (G1.9); G1.19 and G1.22 are dev-only. This path throws; its
			// sibling (`withUnsharedSpine`, G1.20) rebuilds what the walk did reach.
			const message = `commitMultiScope: unshared chain depth ${chain.length} != scope path depth ${s.path.length} (path [${s.path.join(',')}])`;
			assertInvariant('multi-scope-scope-depth', () => ({
				code: 'multi-scope-scope-depth',
				message
			}));
			throw new Error(message);
		}
		// Where the commit turns a read-only view into a mutable node (core/node-views.ts):
		// the copied chain owns the scope node, and the document scope owns the root.
		const owned = isDoc ? (s.node as CstNode) : chain[chain.length - 1];
		// A container that never mounted has no ids, which is not an empty list: starting from
		// `[]` writes one id per structural change against N children, and nothing fixes it.
		const ids = isDoc
			? [...s.state.innerBlockIds]
			: [...(owned.childIds ?? assignIds(owned.children ?? []))];
		const refs = [...s.state.innerBlockRefs];
		// Distinct copies: publishScopeView mutates `ids`/`refs` above in place.
		const savedStateIds = [...s.state.innerBlockIds];
		const savedStateRefs = [...s.state.innerBlockRefs];
		const savedChildren = owned.children;
		const savedChildIds = owned.childIds;
		const savedRaws = captureScopeRaws(chain, owned);
		owned.children = [...(owned.children ?? [])];
		return {
			target: s,
			isDoc,
			chain,
			owned,
			view: { node: owned, children: owned.children!, sharing: deps.sharing },
			ids,
			refs,
			savedChildren,
			savedChildIds,
			savedStateIds,
			savedStateRefs,
			savedRaws
		};
	}

	/**
	 * Document-scope ids go through the deps setters; container ids live on the copied node,
	 * because the state's setter would write the stale shared node's property.
	 */
	function publishScopeView(p: PreparedScope, change: StructuralChange): void {
		applyStructuralChangeToIdsRefs(change, p.ids, p.refs);
		assertIdsInLockstep(
			`commitMultiScope [${p.target.path.join(',')}]`,
			p.ids.length,
			p.owned.children?.length ?? 0
		);
		if (p.isDoc) {
			p.target.state.innerBlockIds = p.ids;
		} else {
			p.owned.childIds = p.ids;
		}
		replaceRefs(p.target.state.innerBlockRefs, p.refs);
	}

	/**
	 * One structural commit across several containers: one undo snapshot, one edit event.
	 * Each scope's ancestors are copied before `mutate` and their raws rebuilt after, deepest
	 * first. Mutate through the provided scope views, never nodes read before the commit.
	 */
	async function commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick, discardIfNoop, trackCaret } = args;
		const prepared: PreparedScope[] = [];
		// Containers whose kind the chain rebuild changed: the replacements are what the dev
		// checks read, and the index is what an unwind restores.
		const reclassified: ContainerReclassification[] = [];
		// Containers the ancestor rebuild collapsed into their parent, with where the caret
		// then goes: a collapse recreates every block in its range, so a scope it swallowed
		// has no ref left to focus.
		const folds: AncestrySeamFold[] = [];
		let landing: FoldLanding | null = null;
		let unwindFolds: (() => void) | null = null;
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				for (const s of scopes) assertScopeIdentity(s);
				// Pushed as each resolves, so a scope that fails to prepare still leaves the
				// rollback holding the state of the scopes prepared before it.
				for (const s of scopes) prepared.push(prepareScopeView(s));
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				// A scope array built at runtime loses the tuple type, so this runtime check
				// backs up the types.
				const changeList: StructuralChange[] = [...changes];
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				for (let i = 0; i < prepared.length; i++) {
					// `savedChildren` is the pre-mutate array `prepareScopeView` swapped out, so
					// the blank-line fix-up reads which blocks were blank off it.
					changeList[i] = settleSeparator(
						prepared[i].owned as SeparatorParent,
						prepared[i].savedChildren ?? [],
						changeList[i],
						deps.sharing,
						trackCaret?.[i],
						deps.grammar
					);
					publishScopeView(prepared[i], changeList[i]);
				}
				// Deepest chains first: an inner scope's raw must be current before an outer
				// chain concatenates it. Truncating to the attached prefix keeps a scope spliced
				// out of the tree from being rebuilt off its emptied children.
				for (const p of [...prepared].sort((a, b) => b.chain.length - a.chain.length)) {
					const before = folds.length;
					reclassified.push(
						...rebuildUnsharedChain(
							deps.doc,
							attachedChainPrefix(deps.doc, p.chain),
							deps.sharing,
							folds,
							deps.grammar
						)
					);
					landing = foldLandingFor(folds.slice(before), p.target.path) ?? landing;
				}
				unwindFolds = publishAncestryFolds(deps, folds);
				return changeList.some((c) => c.op !== 'noop') || folds.length > 0;
			},
			publish: () => {
				// Nudge top-level reactivity so the rewritten ancestor raws propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op,
			afterTick: async () => {
				try {
					await afterTick?.();
				} finally {
					// After the caller's caret placement and regardless of it: the collapse
					// swallowed the scope that placement addressed, so it found no ref, or read
					// through a detached node.
					if (landing) (await deps.revealPath(landing.path))?.focus(landing.offset);
				}
			},
			discardIfNoop,
			// A detached scope is no longer part of the tree; checking one would fire stale-raw
			// on a node the document no longer contains.
			touchedNodes: () =>
				[
					...prepared
						.filter((p) => attachedChainPrefix(deps.doc, p.chain).length === p.chain.length)
						.map((p) => p.owned),
					...reclassified.map((r) => r.replacement)
				].filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined),
			rollback: () => {
				// Collapses unwind first: each restores a whole parent array, which the kind
				// changes below then correct index by index.
				unwindFolds?.();
				// The reverse of the order they happened in, so an index is never restored
				// under a node the next restore is about to replace.
				for (let i = reclassified.length - 1; i >= 0; i--) {
					const { siblings, index, previous } = reclassified[i];
					siblings[index] = previous;
				}
				for (const p of prepared) {
					p.owned.children = p.savedChildren;
					p.owned.childIds = p.savedChildIds;
					// Bytes as well as shape: the chain rebuild calls plugin `rebuildRaw`, so an
					// unwind would otherwise leave raws the children no longer justify.
					for (const { node, raw } of p.savedRaws) {
						node.raw = raw;
						dropChildSpans(node);
					}
					// Without this, the ids and refs written before the throw keep reflecting it.
					if (p.isDoc) p.target.state.innerBlockIds = p.savedStateIds;
					replaceRefs(p.target.state.innerBlockRefs, p.savedStateRefs);
				}
			}
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/** Forwards top-level ids through the deps setter, so the write reaches the `$state`
	 *  proxy; refs are the editor's own array, which every write mutates in place. */
	function createDocScopeAdapter(): BlockListState {
		return {
			get innerBlockIds() {
				return deps.blockIds;
			},
			set innerBlockIds(v: string[]) {
				deps.setBlockIds(v);
			},
			get innerBlockRefs() {
				return deps.blockRefs;
			},
			refSlots: deps.blockRefSlots
		};
	}

	/** The document root as a MultiScopeTarget, for edits whose common ancestor is the document. */
	function getDocScope(): MultiScopeTarget {
		return { node: deps.doc as unknown as NodeView, path: [], state: createDocScopeAdapter() };
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	// Every undo or redo replaces the whole tree, so a caret placement that waited across one
	// is aimed at content that no longer exists. Only ever increments: a placement compares
	// two readings, it never reads the value.
	let historyGeneration = 0;

	function captureCurrentState(): UndoEntry {
		// The same selection read as the snapshot pushes: this is the entry an undo or redo
		// pushes onto the opposite stack, so a gap caret or a selected image's caret survives.
		return {
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			// Fallback when nothing is focused (a headless harness, a programmatic capture).
			selection: entrySelection(() => collapsedSelectionAt(0, 0))
		};
	}

	return {
		sharing: deps.sharing,
		pushUndoSnapshot,
		pushUndoSnapshotPath,
		pushUndoSnapshotDebounced: textBatch.keystroke,
		armUndoPause: textBatch.armPause,
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		historyGeneration: () => historyGeneration,
		noteHistorySwap: () => {
			historyGeneration++;
		},
		flushDebouncedCheckpoint: textBatch.interrupt,
		isolateUndoEntry: (write) => {
			// Both sides: the first break makes the write push its own snapshot instead of
			// joining the burst before it, the second keeps the next keystroke out of it.
			textBatch.interrupt();
			write();
			textBatch.interrupt();
		}
	};
}
