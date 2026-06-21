/**
 * Undo/snapshot controller. Exposes snapshot pushers and commit primitives
 * that wrap structural mutations with undo + reactivity ceremony; the
 * keystroke-batch lifecycle is delegated to text-batch.ts.
 */

import { tick } from 'svelte';
import type { BlockComponent } from '../../block-component';
import type { CstNode, Document } from '../../core/nodes';
import type { EditorSelection } from '../../editor-keys';
import type { UndoEntry } from '../../undo/types';
import type { SelectionPoint } from '../../selection/primitives';
import { digestDoc } from '../../invariants/snapshot-integrity';
import { readCurrentSelection } from '../../selection/native-bridge';
import { pathsEqual } from '../../selection/path-math';
import { assertInvariant } from '../../invariants/assert';
import { nodeAt } from '../../tree-operations/node-ops';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../../tree-operations/unshare';
import { createTextBatch } from './text-batch';
import type {
	CommitContainerStructuralArgs,
	CommitStructuralArgs,
	ContainerScope,
	EditorActionsDeps,
	UndoController
} from '../deps';
import type { CommitMultiScopeArgs, MultiScopeTarget } from '../../action-contracts';
import type { OpDescriptor } from '../../schema/operations';
import { toEditEvent } from '../../editor-events';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../../tree-operations/structural-change';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { assertCommittedNodes, assertUndoTopIntegrity } from '../../invariants/install';
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
	function pushUndoSnapshotAt(blockIndex: number, offset: number): void {
		const live = readCurrentSelection(deps.selectionState, deps.blockRefs);
		const liveIsCollapsed =
			!!live &&
			pathsEqual(live.anchor.path, live.focus.path) &&
			live.anchor.offset === live.focus.offset;
		const selection = liveIsCollapsed
			? collapsedSelectionAtPath(live.anchor.path, offset)
			: collapsedSelectionAt(blockIndex, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
	}

	const textBatch = createTextBatch({
		pushSnapshot: pushUndoSnapshotAt,
		emitInput: (blockIndex, byteLength) =>
			deps.events.emit('edit', {
				op: 'input',
				path: [blockIndex],
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
				snapshot: { blockIndex: number; offset: number } | 'skip';
				/**
				 * Mutate `children` in place; return a StructuralChange describing the
				 * array-shape mutation. The primitive auto-syncs ids/refs from the
				 * descriptor — do NOT splice them inside `mutate`.
				 */
				mutate: (children: CstNode[]) => StructuralChange;
				publish: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void;
				op?: OpDescriptor;
				eventPath: number[];
				afterTick?: () => void;
				/**
				 * Nodes for the dev invariant check when the StructuralChange doesn't
				 * name them. Split/insert/replace are derived from the change; an
				 * in-place kind change (`op: 'noop'`) must point at its leaf here.
				 */
				touchedNodes?: CstNode[];
		  }
		| {
				kind: 'container';
				snapshot: { blockIndex: number; offset: number } | 'skip';
				/**
				 * Apply the inner mutation directly to container state. Callbacks own
				 * their own scope copies + atomic publish back to node.children and
				 * the scope's BlockListState. No StructuralChange is returned to the
				 * primitive — descriptor application happens inside the callback.
				 */
				mutate: () => void;
				/** Post-mutation reactivity nudge (e.g. doc.children = [...doc.children]). */
				publish: () => void;
				op?: OpDescriptor;
				eventPath: number[];
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
		  };

	async function __commit(args: CommitArgs): Promise<void> {
		deps.stickyColumn.reset();
		textBatch.interrupt();

		// Capture before the push so a throwing mutation can roll both stacks
		// back. Wholesale restore (not a pop) because push may evict the oldest
		// at cap.
		const savedStacks = args.snapshot !== 'skip' ? deps.undoManager.getStacks() : null;
		if (args.snapshot !== 'skip') {
			// With no live caret (e.g. a handle drag) the snapshot synthesizes a
			// restore path. A container edit's coordinate is child-relative, so
			// prefix it with the container's eventPath; a document edit's is already
			// a top-level index. (When a caret IS live — every keyboard path — it
			// wins and this fallback is unused.)
			const fallbackPath =
				args.kind === 'container'
					? [...args.eventPath, args.snapshot.blockIndex]
					: [args.snapshot.blockIndex];
			pushUndoSnapshotPath(fallbackPath, args.snapshot.offset);
		}

		// The container branch mutates the live tree in place (its scope views
		// are windows onto live nodes), unlike the document branch which builds
		// on `childrenCopy` and only publishes on success. Capture the top-level
		// array so a throw can discard it: copy-path-on-write means every node
		// the mutation touched was copied before it was written, so the
		// pre-mutation array still reaches an intact tree at every depth.
		const savedDocChildren = args.kind === 'container' ? [...deps.doc.children] : null;

		try {
			if (args.kind === 'document') {
				const childrenCopy = [...deps.doc.children];
				const idsCopy = [...deps.blockIds];
				const refsCopy = [...deps.blockRefs];

				const change = args.mutate(childrenCopy);
				applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);

				args.publish(childrenCopy, idsCopy, refsCopy);
				if (import.meta.env.DEV) {
					assertCommittedNodes(touchedFromChange(change, childrenCopy, args.touchedNodes));
				}
			} else {
				args.mutate();
				args.publish();
				if (import.meta.env.DEV) {
					assertCommittedNodes(touchedContainersWithChildren(args.touchedNodes?.()));
				}
			}
			if (import.meta.env.DEV) {
				// G1.9 commit seam: a missed copy-path-on-write in this commit's
				// mutations corrupts the freshest entry — catch it here, not at
				// some distant undo. assertInvariant routes to devWarn (never
				// throws), so this won't enter the catch.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		} catch (err) {
			if (savedStacks) deps.undoManager.restoreStacks(savedStacks);
			// Discard the container branch's in-place mutation (the document
			// branch never published, so it needs no restore). Restore the
			// top-level array first (structure top-down), then let the rollback
			// thunk recover any in-place splice the array swap couldn't reach.
			if (savedDocChildren) deps.doc.children = savedDocChildren;
			if (args.kind === 'container') args.rollback?.();
			deps.events.emit('error', {
				origin: 'commit',
				error: err,
				context: { op: args.op?.kind, path: args.eventPath }
			});
			// Loud for developers; production swallows so a single failed mutation
			// doesn't kill the editor (the tree stays intact: the document branch
			// publishes only on success, the container branch is rolled back above).
			if (import.meta.env.DEV) throw err;
			return;
		}

		if (args.op) {
			deps.events.emit('edit', toEditEvent(args.op, args.eventPath, Date.now()));
		}

		await tick();
		args.afterTick?.();
	}

	// ── Structural-mutation ceremony ─────────────────────────────────────────
	/** `snapshot: 'skip'` lets composite operations share a single undo entry. */

	async function commitStructural(args: CommitStructuralArgs): Promise<void> {
		const { snapshot, mutate, op, afterTick, touchedNodes } = args;
		// eventPath derives from the snapshot when one is pushed; 'skip' means a
		// caller already owns the event path, so fall back to [] when no snapshot
		// coordinate is available.
		const eventPath = snapshot === 'skip' ? [] : [snapshot.blockIndex];
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
			eventPath,
			afterTick,
			touchedNodes
		});
	}

	/** Single-scope case of commitMultiScope; kept as a named entry for its callers. */
	async function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void> {
		const { containerNode, path, state, snapshot, mutate, op, afterTick } = args;
		await commitMultiScope({
			scopes: [{ node: containerNode, state, path }],
			snapshot,
			mutate: ([scope]) => [mutate(scope)],
			op,
			afterTick
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
	}

	/**
	 * Resolve one scope into an owned mutation view: verify the path still
	 * resolves to the scope node, unshare its spine, attach a working children
	 * array (write-then-re-read contract — tree-operations/unshare.ts header),
	 * and copy ids/refs for descriptor application.
	 */
	function prepareScopeView(s: MultiScopeTarget): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
		if (!isDoc) {
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
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		const owned = isDoc ? s.node : (chain[chain.length - 1] ?? s.node);
		const ids = isDoc ? [...s.state.innerBlockIds] : [...(owned.childIds ?? [])];
		const refs = [...s.state.innerBlockRefs];
		const savedChildren = owned.children;
		const savedChildIds = owned.childIds;
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
			savedChildIds
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
		const { scopes, snapshot, mutate, op, afterTick } = args;
		let prepared: PreparedScope[] = [];
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				prepared = scopes.map(prepareScopeView);
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
				// an outer chain's rebuild concatenates it.
				for (const p of [...prepared].sort((a, b) => b.chain.length - a.chain.length)) {
					rebuildUnsharedChain(p.chain, deps.sharing);
				}
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op,
			eventPath: op?.eventPath ?? [],
			afterTick,
			// The doc scope's node has no block descriptor — exclude it from kind-keyed checks.
			touchedNodes: () =>
				prepared.map((p) => p.owned).filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined),
			rollback: () => {
				for (const p of prepared) {
					p.owned.children = p.savedChildren;
					p.owned.childIds = p.savedChildIds;
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
		return { node: deps.doc as unknown as CstNode, path: [], state: createDocScopeAdapter() };
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
		clearDebouncedCheckpoint: textBatch.discard
	};
}
