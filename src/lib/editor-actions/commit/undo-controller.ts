/**
 * The commit ceremony: snapshot capture, copy-path-on-write unshare, rollback.
 * Owns G1.9 — snapshot-shared nodes stay byte-readonly until this seam unshares
 * them. Keystroke batching is delegated to text-batch.ts.
 */

import { DEV } from 'esm-env';
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
	CommitAfterTick,
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

/** Direct children ride along: a strip rebuild concatenates them into the container. */
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
	 * Snapshots share the live tree's nodes; only the top-level children array is
	 * copied. G1.9: mutations copy-path-on-write first (`tree-operations/unshare.ts`).
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

	// Top-level only: a deep-path caller must route through pushUndoSnapshotPath, or its
	// no-caret fallback restores to the top-level block instead of the edited leaf.
	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		pushUndoSnapshotPath([blockIndex], offset);
	}

	// Path from the live focused leaf, offset from the caller: the live cursor is
	// post-edit, but its path still points at the same leaf.
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
				/** The primitive auto-syncs ids/refs from the returned change — do NOT splice them here. */
				mutate: (children: CstNode[]) => StructuralChange;
				publish: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void;
				op?: ScopedOpDescriptor;
				afterTick?: CommitAfterTick;
				/** Nodes for the DEV check when the change names none (an in-place `op: 'noop'`). */
				touchedNodes?: CstNode[];
				discardIfNoop?: boolean;
		  }
		| {
				kind: 'container';
				snapshot: CommitSnapshotArg;
				/** False when every scope no-op'd. Callbacks own their scope copies and publish. */
				mutate: () => boolean;
				publish: () => void;
				op?: ScopedOpDescriptor;
				afterTick?: CommitAfterTick;
				/** Thunk: the owned nodes only exist once `mutate` has unshared them. */
				touchedNodes?: () => CstNode[];
				/**
				 * Restores in-place splices into nodes already unshared this undo unit,
				 * which the top-level array swap can't reach.
				 */
				rollback?: () => void;
				discardIfNoop?: boolean;
		  };

	interface RollbackFrame {
		restore(): void;
	}

	/**
	 * Every register a throwing or discardIfNoop-bailing commit rolls back, in one
	 * place. Container per-scope registers aren't minted until `mutate` unshares, so
	 * restore() delegates those to the `rollback` thunk.
	 */
	function captureRollbackFrame(args: CommitArgs): RollbackFrame {
		// Wholesale restore, not a pop: the push may evict the oldest at cap.
		const savedStacks = args.snapshot !== 'skip' ? deps.undoManager.getStacks() : null;
		// The container branch mutates the live tree in place; the document branch
		// publishes only on success, so it has nothing to restore.
		const savedDocChildren = args.kind === 'container' ? [...deps.doc.children] : null;
		return {
			restore() {
				// Top-down: stacks, top-level array, then the thunk for the in-place splices
				// the array swap can't reach.
				if (savedStacks) deps.undoManager.restoreStacks(savedStacks);
				if (savedDocChildren) deps.doc.children = savedDocChildren;
				if (args.kind === 'container') args.rollback?.();
			}
		};
	}

	/** The one door to the `error` channel, so every throw site attributes alike (editor.md §12). */
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

		if (DEV) {
			// Both declared coordinates must be doc-absolute; `invariants` stays a runtime
			// leaf, so the number[]→DocPath mint lives here at the ceremony.
			assertCommitPaths(
				deps.doc,
				args.snapshot === 'skip' ? null : asDocPath(args.snapshot.path),
				args.op?.eventPath ? asDocPath(args.op.eventPath) : null
			);
		}

		// Outside the try: the stack registers must be read BEFORE the push below.
		const rollback = captureRollbackFrame(args);

		// A `discardIfNoop` op that changed nothing takes the throw path's restore minus
		// the error emit. afterTick still runs.
		let discarded = false;
		try {
			if (args.snapshot !== 'skip') {
				// Inside the try: readCurrentSelection walks live block refs, plugin leaves
				// included, so it throws like every other ceremony site.
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
					if (DEV) {
						assertCommittedNodes(touchedFromChange(change, childrenCopy, args.touchedNodes));
					}
				}
			} else {
				const changed = args.mutate();
				if (args.discardIfNoop && !changed) {
					// The in-place mutation ran but every scope no-op'd — unwind as a throw would.
					rollback.restore();
					discarded = true;
				} else {
					args.publish();
					if (DEV) {
						assertCommittedNodes(touchedContainersWithChildren(args.touchedNodes?.()));
					}
				}
			}
			if (!discarded && DEV) {
				// G1.9 commit seam: a missed copy-path-on-write here corrupts the freshest
				// entry — catch it at the commit, not at some distant undo. Never throws.
				assertUndoTopIntegrity(deps.undoManager.peekUndo() ?? undefined);
			}
		} catch (err) {
			rollback.restore();
			reportCommitError(args, err);
			// Loud in dev; production swallows so one failed mutation doesn't kill the
			// editor. The tree is intact either way: rolled back, or never published.
			if (DEV) throw err;
			return false;
		}

		if (!discarded && args.op) {
			deps.events.emit('edit', toEditEvent(args.op, args.op.eventPath, Date.now()));
		}

		return true;
	}

	// Bracket the synchronous ceremony (DEV-only) so the decoration engine can assert no
	// source runs inside a half-applied commit. Cleared before the first await.
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
			// Awaited: a landing that reveals an off-window target is async, and this
			// promise is what every caller treats as "the caret has settled".
			await args.afterTick?.();
		} catch (err) {
			// No rollback: the commit succeeded and the tree is correct. Contained so a
			// plugin's afterTick is a reported no-op, not an unhandled rejection.
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
		/** Pre-swap arrays: the rollback target when the mutate spliced this scope in place. */
		savedChildren: CstNode[] | undefined;
		savedChildIds: string[] | undefined;
		/** publishScopeView writes the MUTATED ids/refs before the ancestor-raw rebuild can throw. */
		savedStateIds: string[];
		savedStateRefs: (BlockComponent | undefined)[];
		/** Pre-mutate bytes; without them `serialize()` emits a half-applied document. */
		savedRaws: SavedRaw[];
	}

	interface SavedRaw {
		node: CstNode;
		raw: string;
	}

	/** Bytes at risk: the unshared spine plus direct children — `savedChildren`'s granularity. */
	function captureScopeRaws(chain: CstNode[], owned: CstNode): SavedRaw[] {
		const saved: SavedRaw[] = chain.map((node) => ({ node, raw: node.raw }));
		for (const child of owned.children ?? []) saved.push({ node: child, raw: child.raw });
		return saved;
	}

	/**
	 * Runs over ALL scopes BEFORE any spine is unshared: preparing an earlier scope
	 * copies nodes a later, overlapping scope still points at.
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

	/** Unshares the spine and attaches a working children array (`tree-operations/unshare.ts`). */
	function prepareScopeView(s: MultiScopeTarget): PreparedScope {
		const isDoc = (s.node as unknown) === (deps.doc as unknown);
		const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
		if (!isDoc && chain.length !== s.path.length) {
			// Falling back to the caller's still-shared node would silently corrupt the
			// snapshot entry sharing it (G1.9); G1.19/G1.22 are dev-only. Bail, as the
			// sibling seam (`withUnsharedSpine`, G1.20) does.
			const message = `commitMultiScope: unshared chain depth ${chain.length} != scope path depth ${s.path.length} (path [${s.path.join(',')}])`;
			assertInvariant('multi-scope-scope-depth', () => ({
				code: 'multi-scope-scope-depth',
				message
			}));
			throw new Error(message);
		}
		// The ceremony's view→mutable door (core/node-views.ts): the unshared chain owns
		// the scope node, and the doc scope owns the root by construction.
		const owned = isDoc ? (s.node as CstNode) : chain[chain.length - 1];
		const ids = isDoc ? [...s.state.innerBlockIds] : [...(owned.childIds ?? [])];
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
	 * Doc-scope ids route through deps setters; container ids live on the owned node,
	 * because the state bundle's setter would write the stale shared node prop.
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
	 * Atomic structural commit across container scopes — one undo snapshot, one edit
	 * event. Each spine is unshared before `mutate` and raw-rebuilt after, deepest
	 * first. Mutate through the provided scope views, never pre-commit captures.
	 */
	async function commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick, discardIfNoop } = args;
		const prepared: PreparedScope[] = [];
		// Container slots the chain rebuild re-kinded: the replacements are what the DEV
		// probes check, and the slot is what an unwind restores.
		const reclassified: ContainerReclassification[] = [];
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				for (const s of scopes) assertScopeIdentity(s);
				// Pushed as each resolves, so a scope that fails to prepare still leaves the
				// frame holding the registers of the scopes prepared before it.
				for (const s of scopes) prepared.push(prepareScopeView(s));
				const changes = mutate(prepared.map((p) => p.view) as { [K in keyof S]: ContainerScope });
				// Dynamically-built scope arrays degrade to array typing, so this runtime
				// check backstops the tuple types.
				const changeList: readonly StructuralChange[] = changes;
				if (changeList.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changeList.length} changes for ${scopes.length} scopes`
					);
				}
				for (let i = 0; i < prepared.length; i++) {
					publishScopeView(prepared[i], changeList[i]);
				}
				// Deepest chains first: an inner scope's raw must be current before an outer
				// chain concatenates it. Truncating to the attached prefix keeps a
				// spliced-out scope from being rebuilt off its emptied children.
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
			// Detached scopes are no longer committed tree state — checking one would fire
			// stale-raw on a node the document no longer contains.
			touchedNodes: () =>
				[
					...prepared
						.filter((p) => attachedChainPrefix(deps.doc, p.chain).length === p.chain.length)
						.map((p) => p.owned),
					...reclassified.map((r) => r.replacement)
				].filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined),
			rollback: () => {
				// Reverse of the landing order, so a slot is never restored under a node the
				// next restore is about to replace.
				for (let i = reclassified.length - 1; i >= 0; i--) {
					const { siblings, index, previous } = reclassified[i];
					siblings[index] = previous;
				}
				for (const p of prepared) {
					p.owned.children = p.savedChildren;
					p.owned.childIds = p.savedChildIds;
					// Bytes as well as shape: the chain rebuild dispatches into plugin
					// `rebuildRaw`, so an unwind leaves raws the children no longer justify.
					for (const { node, raw } of p.savedRaws) node.raw = raw;
					// Without this, ids/refs published before the throw keep reflecting it.
					if (p.isDoc) p.target.state.innerBlockIds = p.savedStateIds;
					p.target.state.innerBlockRefs = p.savedStateRefs;
				}
			}
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/** Forwards top-level ids/refs through deps setters, so publishes reach the `$state` proxies. */
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

	/** The document root as a MultiScopeTarget, for cross-scope ops whose LCA is doc level. */
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
