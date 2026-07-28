/**
 * Undo/snapshot controller. Exposes snapshot pushers and commit primitives
 * that wrap structural mutations with undo + reactivity ceremony; the
 * keystroke-batch lifecycle is delegated to text-batch.ts.
 */

import { tick } from 'svelte';
import type { BlockComponent } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import type { EditorSelection } from '../../selection/primitives';
import type { UndoEntry } from '../../undo/types';
import type { SelectionPoint } from '../../selection/primitives';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { readCurrentSelection } from '../../selection/native-bridge';
import { asDocPath, pathsEqual } from '../../selection/path-math';
import { assertInvariant } from '../../invariants/assert';
import { beginCommit, endCommit } from '../../invariants/commit-scope';
import { nodeAt } from '../../tree-operations/node-ops';
import {
	attachedChainPrefix,
	ensureUnsharedPath,
	rebuildUnsharedChain,
	type ContainerReclassification
} from '../../tree-operations/unshare';
import { createTextBatch } from './text-batch';
import type {
	CommitContainerStructuralArgs,
	CommitStructuralArgs,
	ContainerScope,
	EditorActionsDeps,
	UndoController
} from '../deps';
import type {
	CommitMultiScopeArgs,
	CommitSnapshotArg,
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
	assertUndoTopIntegrity
} from '../../invariants/install';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import {
	docByteLength,
	perfEnabled,
	recordSnapshotClone,
	setUndoGauge
} from '../../perf/instruments';

// ── Dev invariant scoping (DEV-only paths) ────────────────────────────────────

/**
 * Top-level nodes a document-scope commit produced. Insert/replace name their
 * new positions in the StructuralChange; a `noop` (in-place kind change) names
 * nothing, so the caller passes the leaf via `explicit`.
 */
function touchedFromChange(
	change: StructuralChange,
	children: CstNode[],
	explicit: CstNode[] | undefined
): CstNode[] {
	if (change.op === 'insert') return children.slice(change.at, change.at + change.count);
	if (change.op === 'replace') return children.slice(change.at, change.at + change.newCount);
	return explicit ?? [];
}

/** A directly-mutated container plus its direct children (the changed leaves a strip rebuild concatenates). */
function touchedContainersWithChildren(containers: CstNode[] | undefined): CstNode[] {
	if (!containers) return [];
	const out: CstNode[] = [];
	for (const c of containers) {
		out.push(c);
		if (c.children) out.push(...c.children);
	}
	return out;
}

export function createUndoController(deps: EditorActionsDeps): UndoController {
	// ── Selection helpers ─────────────────────────────────────────────────────

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
	 * Snapshots share the live tree's nodes (epoch-marked) instead of deep
	 * cloning — only the top-level children array is copied. Mutations must
	 * copy-path-on-write before touching any shared node (tree-operations/
	 * unshare.ts); the DEV integrity digest catches writes that don't.
	 */
	function shareSnapshot(): Pick<UndoEntry, 'snapshot' | 'integrity'> {
		deps.sharing.markSnapshotTaken();
		const snapshot: Document = {
			kind: 'document',
			prefix: deps.doc.prefix,
			children: [...deps.doc.children],
			suffix: deps.doc.suffix
		};
		return { snapshot, integrity: import.meta.env.DEV ? digestDoc(snapshot) : undefined };
	}

	function recordSnapshotPerf(): void {
		if (!perfEnabled()) return;
		recordSnapshotClone(docByteLength(deps.doc));
		const undo = deps.undoManager.getStacks().undo;
		let liveBytes = 0;
		for (const entry of undo) liveBytes += docByteLength(entry.snapshot);
		setUndoGauge(liveBytes, undo.length);
	}

	function pushUndoSnapshotPath(fallbackPath: number[], offset: number): void {
		const selection =
			readCurrentSelection(deps.selectionState, deps.blockRefs) ??
			collapsedSelectionAtPath(fallbackPath, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
	}

	// Top-level coordinate wrapper; deep-path callers (nested replace, __commit
	// fallback) use pushUndoSnapshotPath directly so their no-caret fallback
	// seeds the real leaf, not the top-level block.
	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		pushUndoSnapshotPath([blockIndex], offset);
	}

	// Path from the live focused leaf; offset from the caller (pre-edit). The
	// live cursor is post-edit but its path still points at the same leaf.
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
	/**
	 * Universal commit ceremony: snapshot push, mutation, atomic publish, edit
	 * event emission, tick, post-tick callback. Public wrappers
	 * (`commitStructural`, `commitContainerStructural`, `commitMultiScope`)
	 * delegate here via one of the two kind-specific shapes. Document-kind
	 * owns top-level children/ids/refs and auto-syncs them from the returned
	 * StructuralChange; container-kind owns its own per-scope state inside
	 * the mutate callback and only needs the ceremony to fire the snapshot,
	 * event, and reactivity nudge around it.
	 */

	type CommitArgs =
		| {
				kind: 'document';
				snapshot: CommitSnapshotArg;
				/**
				 * Mutate `children` in place; return a StructuralChange describing the
				 * array-shape mutation. The primitive auto-syncs ids/refs from the
				 * descriptor — do NOT splice them inside `mutate`.
				 */
				mutate: (children: CstNode[]) => StructuralChange;
				publish: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void;
				op?: ScopedOpDescriptor;
				afterTick?: () => void;
				/**
				 * Nodes for the dev invariant check when the StructuralChange doesn't
				 * name them. Split/insert/replace are derived from the change; an
				 * in-place kind change (`op: 'noop'`) must point at its leaf here.
				 */
				touchedNodes?: CstNode[];
				discardIfNoop?: boolean;
		  }
		| {
				kind: 'container';
				snapshot: CommitSnapshotArg;
				/**
				 * Apply the inner mutation directly to container state; return whether
				 * anything actually changed (false when every scope no-op'd — the
				 * `discardIfNoop` twin of a document-branch `op: 'noop'`). Callbacks own
				 * their own scope copies + atomic publish back to node.children and
				 * the scope's BlockListState. No StructuralChange is returned to the
				 * primitive — descriptor application happens inside the callback.
				 */
				mutate: () => boolean;
				/** Post-mutation reactivity nudge (e.g. doc.children = [...doc.children]). */
				publish: () => void;
				op?: ScopedOpDescriptor;
				afterTick?: () => void;
				/**
				 * Directly-mutated containers (innermost scopes) for the dev invariant
				 * check. Thunk: the owned nodes only exist after `mutate` unshares.
				 */
				touchedNodes?: () => CstNode[];
				/**
				 * Restore each scope's pre-mutate children/childIds on throw. The
				 * top-level array swap can't reach an in-place splice into a node
				 * already unshared this undo unit; this thunk does. Closes over the
				 * scopes `mutate` prepared, so it only resolves after `mutate` ran.
				 */
				rollback?: () => void;
				discardIfNoop?: boolean;
		  };

	/** Every register a throwing (or discardIfNoop-bailing) commit must roll back, in one place. */
	interface RollbackFrame {
		restore(): void;
	}

	/**
	 * Capture the commit's recovery state once. A throw or a discardIfNoop bail
	 * calls restore(); the catch and discard sites hold no loose registers of
	 * their own, so a future ceremony register lives in this frame or it visibly
	 * won't recover. The container's per-scope registers can't live here — the
	 * owned children/ids aren't minted until `mutate` unshares the spine, and the
	 * scope state readers ride the scopes CommitArgs doesn't carry — so restore()
	 * delegates to the `rollback` thunk `commitMultiScope` prepared for them.
	 */
	function captureRollbackFrame(args: CommitArgs): RollbackFrame {
		// Wholesale stack restore, not a pop (the push may evict the oldest at cap).
		// Must be captured before the push mutates the stacks.
		const savedStacks = args.snapshot !== 'skip' ? deps.undoManager.getStacks() : null;
		// The container branch mutates the live tree in place (its scope views are
		// windows onto live nodes); capture the top-level array so restore() discards
		// it. copy-path-on-write copied every touched node before writing it, so this
		// pre-mutation array reaches an intact tree at every depth. The document branch
		// builds on a copy and publishes only on success — nothing to restore.
		const savedDocChildren = args.kind === 'container' ? [...deps.doc.children] : null;
		return {
			restore() {
				// Structure top-down: stacks, then the top-level array, then the
				// container thunk recovers an in-place splice into a node already
				// unshared this undo unit — the array swap can't reach it.
				if (savedStacks) deps.undoManager.restoreStacks(savedStacks);
				if (savedDocChildren) deps.doc.children = savedDocChildren;
				if (args.kind === 'container') args.rollback?.();
			}
		};
	}

	/**
	 * The one place a contained ceremony failure reaches the `error` channel, so
	 * every throw site attributes the same way (editor.md §12). Both the
	 * synchronous ceremony and the post-tick callback route here.
	 */
	function reportCommitError(args: CommitArgs, error: unknown): void {
		deps.events.emit('error', {
			origin: 'commit',
			error,
			context: { op: args.op?.kind, path: args.op?.eventPath }
		});
	}

	function runCommitCeremony(args: CommitArgs): boolean {
		deps.stickyColumn.reset();
		textBatch.interrupt();

		if (import.meta.env.DEV) {
			// Pre-mutate: both declared coordinates must be doc-absolute — a
			// scope-local index leaking in fails here, not at some distant undo.
			// The mint gates the guard's DocPath entry; invariants stays a runtime
			// leaf, so the number[]→DocPath mint lives here at the commit ceremony.
			assertCommitPaths(
				deps.doc,
				args.snapshot === 'skip' ? null : asDocPath(args.snapshot.path),
				args.op?.eventPath ? asDocPath(args.op.eventPath) : null
			);
		}

		// Captured outside the try: the stack registers must be read BEFORE the push
		// below mutates them.
		const rollback = captureRollbackFrame(args);

		// A `discardIfNoop` structural op that changed nothing (chrome split, a
		// no-target merge) rolls back the snapshot pushed below — the benign twin
		// of the throw path: same stack/tree restore, minus the error emit. Skips
		// publish and the edit event; afterTick still runs (caret is a view
		// concern, so the no-target merge's focus fallback survives).
		let discarded = false;
		try {
			if (args.snapshot !== 'skip') {
				// Inside the try: readCurrentSelection walks live block refs, including
				// plugin-authored leaves, so this is a reporting throw site like every
				// other one in the ceremony. With no live caret (e.g. a handle drag) the
				// snapshot restores to the declared coordinate. (When a caret IS live —
				// every keyboard path — it wins and this fallback is unused.)
				pushUndoSnapshotPath(args.snapshot.path, args.snapshot.offset);
			}
			if (args.kind === 'document') {
				const childrenCopy = [...deps.doc.children];
				const idsCopy = [...deps.blockIds];
				const refsCopy = [...deps.blockRefs];

				const change = args.mutate(childrenCopy);
				if (args.discardIfNoop && change.op === 'noop') {
					// Document branch never published; the frame restores only the stacks here.
					rollback.restore();
					discarded = true;
				} else {
					applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);
					args.publish(childrenCopy, idsCopy, refsCopy);
					if (import.meta.env.DEV) {
						assertCommittedNodes(touchedFromChange(change, childrenCopy, args.touchedNodes));
					}
				}
			} else {
				const changed = args.mutate();
				if (args.discardIfNoop && !changed) {
					// The in-place mutation ran (spine unshare, per-scope publish, raw
					// rebuild) but every scope no-op'd — unwind it exactly as a throw would.
					rollback.restore();
					discarded = true;
				} else {
					args.publish();
					if (import.meta.env.DEV) {
						assertCommittedNodes(touchedContainersWithChildren(args.touchedNodes?.()));
					}
				}
			}
			if (!discarded && import.meta.env.DEV) {
				// G1.9 commit seam: a missed copy-path-on-write in this commit's
				// mutations corrupts the freshest entry — catch it here, not at
				// some distant undo. assertInvariant routes to devWarn (never
				// throws), so this won't enter the catch.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		} catch (err) {
			rollback.restore();
			reportCommitError(args, err);
			// Loud for developers; production swallows so a single failed mutation
			// doesn't kill the editor (the tree stays intact: the document branch
			// publishes only on success, the container branch is rolled back above).
			if (import.meta.env.DEV) throw err;
			return false;
		}

		if (!discarded && args.op) {
			deps.events.emit('edit', toEditEvent(args.op, args.op.eventPath, Date.now()));
		}

		return true;
	}

	// Bracket the synchronous ceremony (DEV-only) so the decoration engine can assert
	// no source runs inside a half-applied commit. Cleared before the first await, so a
	// deferred notifyEdit — always ≥1 tick behind the edit event — never false-fires.
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
			args.afterTick?.();
		} catch (err) {
			// No rollback: the commit succeeded and the tree is correct — a post-tick
			// view callback failing is not a reason to unwind it. Contained
			// unconditionally, like the block-command seam: a plugin callback (the
			// public `updateOwnMetadata(patch, afterTick)` threads one straight here)
			// becomes a reported no-op, never an unhandled rejection on a promise
			// every caller voids.
			reportCommitError(args, err);
		}
	}

	// ── Structural-mutation ceremony ─────────────────────────────────────────
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

	/** Single-scope case of commitMultiScope; kept as a named entry for its callers. */
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
		/**
		 * The owned node's pre-swap children/childIds arrays — the rollback target
		 * when this scope was already unshared earlier in the same undo unit, so
		 * copy-path-on-write was a no-op and the mutate spliced in place (the
		 * top-level array swap can't reach an in-place mutation). Pre-swap because
		 * `prepareScopeView` replaces `owned.children` with a fresh working array
		 * the mutate then dirties; the array that sat there before is an untouched
		 * snapshot of the post-prior-op state.
		 */
		savedChildren: CstNode[] | undefined;
		savedChildIds: string[] | undefined;
		/**
		 * Pre-publish snapshots of the reactive ids/refs this scope publishes into.
		 * publishScopeView writes the MUTATED ids/refs (doc-scope ids route through
		 * the setter to top-level blockIds; every scope's refs into innerBlockRefs)
		 * before the ancestor-raw rebuild — a throw there must restore them, else
		 * top-level blockIds/refs keep reflecting the rolled-back mutation until the
		 * next commit. (Container ids live on childIds, restored via savedChildIds.)
		 */
		savedStateIds: string[];
		savedStateRefs: (BlockComponent | undefined)[];
		/**
		 * Pre-mutate bytes for every node this scope's commit writes in place. The
		 * structural registers above recover the shape; without this the restored
		 * children disagree with the serialized raw and the next `serialize()`
		 * emits a half-applied document.
		 */
		savedRaws: SavedRaw[];
	}

	interface SavedRaw {
		node: CstNode;
		raw: string;
	}

	/**
	 * Bytes at risk for one scope: the unshared spine (every target of the chain
	 * rebuild, which runs after all scopes' writes and dispatches into a
	 * descriptor's `rebuildRaw`) plus the scope's direct children (a grid rebuild
	 * rewrites its rows; renumber and marker passes rewrite its items). Depth
	 * mirrors the structural register — one level below the owned node, the same
	 * granularity `savedChildren` restores.
	 */
	function captureScopeRaws(chain: CstNode[], owned: CstNode): SavedRaw[] {
		const saved: SavedRaw[] = chain.map((node) => ({ node, raw: node.raw }));
		for (const child of owned.children ?? []) saved.push({ node: child, raw: child.raw });
		return saved;
	}

	/**
	 * Verify a scope's path still resolves to its node. Runs over ALL scopes
	 * BEFORE any spine is unshared: preparing an earlier scope copies spine
	 * nodes that a later, overlapping scope's captured reference still points
	 * at, so checking mid-preparation false-fires on the ceremony's own copies.
	 */
	function assertScopeIdentity(s: MultiScopeTarget): void {
		if ((s.node as unknown) === (deps.doc as unknown)) return;
		// A stale-but-in-range path would unshare and rebuild the wrong spine.
		assertInvariant('multi-scope-commit-path', () =>
			nodeAt(deps.doc, s.path) === s.node
				? null
				: {
						code: 'multi-scope-commit-path',
						message: `commit: path [${s.path.join(',')}] does not resolve to scope node (${s.node.kind})`
					}
		);
	}

	/**
	 * Resolve one scope into an owned mutation view: unshare its spine, attach
	 * a working children array (write-then-re-read contract —
	 * tree-operations/unshare.ts header), and copy ids/refs for descriptor
	 * application. Path identity is asserted by the pristine pre-pass.
	 */
	function prepareScopeView(s: MultiScopeTarget): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		if (!isDoc && chain.length !== s.path.length) {
			// The unshare walk ran off a live child, so the chain has no scope node to
			// hand over. Falling back to the caller's node would give the mutation a
			// still-shared node and corrupt the snapshot entry that shares it (G1.9) —
			// silently, since G1.19/G1.22 are dev-only warnings. Bail the commit, the
			// answer the sibling seam (`withUnsharedSpine`, G1.20) already gives.
			const message = `commitMultiScope: unshared chain depth ${chain.length} != scope path depth ${s.path.length} (path [${s.path.join(',')}])`;
			assertInvariant('multi-scope-scope-depth', () => ({
				code: 'multi-scope-scope-depth',
				message
			}));
			throw new Error(message);
		}
		// The ceremony's view→mutable door (core/node-views.ts): the unshared
		// chain owns the scope node; the doc scope owns the root by construction.
		const owned = isDoc ? (s.node as CstNode) : chain[chain.length - 1];
		const ids = isDoc ? [...s.state.innerBlockIds] : [...(owned.childIds ?? [])];
		const refs = [...s.state.innerBlockRefs];
		// Distinct copies: `ids`/`refs` above are mutated in place by
		// publishScopeView; these stay frozen as the rollback target.
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
	 * Apply one scope's StructuralChange to its ids/refs and publish them.
	 * Doc-scope ids route through deps setters (top-level ids are per-snapshot
	 * copies); container ids live on the owned node — the state bundle's setter
	 * would write the stale shared node prop.
	 */
	function publishScopeView(p: PreparedScope, change: StructuralChange): void {
		applyStructuralChangeToIdsRefs(change, p.ids, p.refs);
		if (p.isDoc) {
			p.target.state.innerBlockIds = p.ids;
		} else {
			p.owned.childIds = p.ids;
		}
		p.target.state.innerBlockRefs = p.refs;
	}

	/**
	 * Atomic structural commit spanning multiple container scopes — one undo
	 * snapshot, per-scope children views, one edit event. Use for operations
	 * touching ≥2 container nodes (e.g., indent across parent + nested list).
	 *
	 * Copy-path-on-write: each scope's spine is unshared before `mutate`, the
	 * owned nodes get their working children arrays attached (so rebuild /
	 * renumber helpers reading node.children see live shape mid-mutate), and
	 * the owned spine chains are raw-rebuilt afterwards, deepest scope first.
	 * Mutate through the provided scope views, never pre-commit captures.
	 */
	async function commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick, discardIfNoop } = args;
		const prepared: PreparedScope[] = [];
		// Container slots the chain rebuild re-kinded. Two registers ride on this: the
		// replacements are what the DEV probes check (the swapped-out nodes are detached,
		// so `touchedNodes` would skip them), and the slot puts the old node back on an
		// unwind, which no other rollback register reaches.
		const reclassified: ContainerReclassification[] = [];
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				for (const s of scopes) assertScopeIdentity(s);
				// Pushed as each scope resolves, not assigned at the end: a scope that
				// fails to prepare must still leave the frame holding the registers of
				// the scopes prepared before it.
				for (const s of scopes) prepared.push(prepareScopeView(s));
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				// Dynamically-built scope arrays degrade to array typing, so the
				// runtime arity check stays as the backstop behind the tuple types.
				const changeList: readonly StructuralChange[] = changes;
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				for (let i = 0; i < prepared.length; i++) {
					publishScopeView(prepared[i], changeList[i]);
				}
				// Deepest chains first: an inner scope's raw must be current before
				// an outer chain's rebuild concatenates it. Chains truncate to their
				// attached prefix: a scope the mutation spliced out (emptied nested
				// list, consumed endpoint) must not have its raw rebuilt from its
				// emptied children — its live ancestors still get theirs.
				for (const p of [...prepared].sort((a, b) => b.chain.length - a.chain.length)) {
					reclassified.push(
						...rebuildUnsharedChain(
							deps.doc,
							attachedChainPrefix(deps.doc, p.chain),
							deps.sharing,
							deps.grammar
						)
					);
				}
				return changeList.some((c) => c.op !== 'noop');
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op,
			afterTick,
			discardIfNoop,
			// Detached scopes are no longer committed tree state — checking one
			// would fire stale-raw on a node the document no longer contains. The
			// doc scope's node has no block descriptor — excluded by the kind filter.
			touchedNodes: () =>
				[
					...prepared
						.filter((p) => attachedChainPrefix(deps.doc, p.chain).length === p.chain.length)
						.map((p) => p.owned),
					...reclassified.map((r) => r.replacement)
				].filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined),
			rollback: () => {
				// Innermost-last: the swaps landed outermost-first per chain, so putting
				// them back in reverse leaves no replacement holding a slot.
				for (let i = reclassified.length - 1; i >= 0; i--) {
					const { siblings, index, previous } = reclassified[i];
					siblings[index] = previous;
				}
				for (const p of prepared) {
					p.owned.children = p.savedChildren;
					p.owned.childIds = p.savedChildIds;
					// Bytes as well as shape: the chain rebuild runs after every scope's
					// writes and dispatches into `descriptor.rebuildRaw` (plugin code at
					// the freeze boundary), so both a throw there and the discardIfNoop
					// bail behind it unwind raws the restored children no longer justify.
					for (const { node, raw } of p.savedRaws) node.raw = raw;
					// publishScopeView may have written the mutated ids/refs into reactive
					// state before the throw; restore them so top-level blockIds/refs don't
					// reflect the rolled-back mutation. Doc-scope ids route through the
					// setter to top-level blockIds; container ids restored via childIds above.
					if (p.isDoc) p.target.state.innerBlockIds = p.savedStateIds;
					p.target.state.innerBlockRefs = p.savedStateRefs;
				}
			}
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/**
	 * The document root standing in as a scope: forwards top-level ids/refs
	 * through deps setters so publish-time assignments reach the Svelte $state
	 * proxies. The indirection is the adaptation, not a Middle-Man.
	 */
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
			set innerBlockRefs(v: (BlockComponent | undefined)[]) {
				deps.setBlockRefs(v);
			}
		};
	}

	/**
	 * Expose the document root as a MultiScopeTarget so cross-scope ops with
	 * an LCA at doc level can include it.
	 */
	function getDocScope(): MultiScopeTarget {
		return { node: deps.doc as unknown as NodeView, path: [], state: createDocScopeAdapter() };
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		const selection = readCurrentSelection(deps.selectionState, deps.blockRefs);
		// Fallback for unfocused-at-capture (headless harness, programmatic capture).
		return {
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection: selection ?? collapsedSelectionAt(0, 0)
		};
	}

	return {
		sharing: deps.sharing,
		pushUndoSnapshot,
		pushUndoSnapshotPath,
		pushUndoSnapshotDebounced: textBatch.keystroke,
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		collapsedSelectionAt,
		flushDebouncedCheckpoint: textBatch.interrupt
	};
}
