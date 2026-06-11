/**
 * Undo/snapshot controller. Owns the keystroke-debounce timer and the
 * "needs new checkpoint" flag; exposes snapshot pushers and commit
 * primitives that wrap structural mutations with undo + reactivity ceremony.
 */

import { tick } from 'svelte';
import type { BlockComponent } from '../block-component';
import type { CstNode, Document } from '../core/nodes';
import type { EditorSelection } from '../editor-keys';
import type { UndoEntry } from '../undo/types';
import type { SelectionPoint } from '../selection/primitives';
import { digestDoc } from '../invariants/sharing';
import { readCurrentSelection } from '../selection/native-bridge';
import { pathsEqual } from '../selection/path-math';
import { assertInvariant } from '../invariants/assert';
import { nodeAt } from '../tree-operations/node-ops';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../tree-operations/unshare';
import type {
	CommitContainerStructuralArgs,
	CommitMultiScopeArgs,
	CommitStructuralArgs,
	EditorActionsDeps,
	UndoController
} from './deps';
import type { OpDescriptor } from '../action-contracts';
import type { EditEvent } from '../editor-events';
import {
	applyStructuralChangeToIdsRefs,
	type StructuralChange
} from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import { assertCommittedNodes, assertUndoTopIntegrity } from '../invariants/install';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { docByteLength, perfEnabled, recordSnapshotClone, setUndoGauge } from '../perf/instruments';

// ── Multi-scope commit types ──────────────────────────────────────────────────

/**
 * Order matters for the emitted event path — scopes[0] is the outermost.
 * `path` is the scope node's doc-absolute path; the primitive unshares each
 * scope's spine before `mutate` and rebuilds the owned chains after.
 */
export interface MultiScopeTarget {
	node: CstNode;
	state: BlockListState;
	path: number[];
}

/**
 * Mutable view of one scope. `node` is the OWNED (unshared) scope node with
 * `children` attached — mutate through it, never through pre-commit captures.
 * Return a StructuralChange[] (one per scope, same order); the primitive
 * applies descriptors to ids/refs.
 */
export interface MultiScopeMutable {
	children: CstNode[];
	node: CstNode;
}

/**
 * Keystroke-batch window. 500 ms reverted entire half-words at typical typing
 * speeds; 250 ms roughly matches Obsidian. Word-boundary flushing (like VS Code
 * / Google Docs) is a potential refinement.
 */
const UNDO_DEBOUNCE_MS = 250;

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
	let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	// Per-leaf identity for batch-break detection. Stable string id (preferred,
	// supplied for container scopes) or numeric blockIndex (top-level fallback).
	// Container typing must not key on the outer container's index — sibling
	// leaves inside one container would share a batch across focus moves.
	let lastUndoBatchKey: string | number = -1;
	// When true, the next keystroke captures a "before" snapshot.
	let needsUndoCheckpoint = true;
	// Batch tracking for input-event emission on debounce flush.
	let batchBlockIndex = -1;
	let batchByteLength = 0;

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

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		const selection =
			readCurrentSelection(deps.selectionState, deps.blockRefs) ??
			collapsedSelectionAt(blockIndex, offset);
		deps.undoManager.push({
			...shareSnapshot(),
			blockIds: [...deps.blockIds],
			selection
		});
		recordSnapshotPerf();
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

	/**
	 * Emit the pending typing batch as one input event, then drop the batch
	 * state. Must run before anything discards or repoints the batch —
	 * otherwise observers under-count keystrokes and the inline sweep never
	 * refreshes the batch's subtree with a resolver.
	 */
	function flushPendingInputBatch(): void {
		if (batchByteLength > 0 && batchBlockIndex >= 0) {
			deps.events.emit('edit', {
				op: 'input',
				path: [batchBlockIndex],
				detail: { byteLength: batchByteLength },
				timestamp: Date.now()
			});
		}
		batchBlockIndex = -1;
		batchByteLength = 0;
	}

	/**
	 * First keystroke of each batch captures a snapshot; subsequent keystrokes
	 * reset the debounce.
	 *
	 * `setTimeout` is intentional despite the editor's "no setTimeout for
	 * sequencing" rule — this is wall-clock pause detection, not async
	 * ordering. `await tick()` is microtask-grained and can't express "user
	 * has stopped typing for ~250ms."
	 */
	function pushUndoSnapshotDebounced(
		blockIndex: number,
		offset: number,
		batchKey?: string | number
	): void {
		const key = batchKey ?? blockIndex;
		if (lastUndoBatchKey !== key || needsUndoCheckpoint) {
			flushPendingInputBatch();
			pushUndoSnapshotAt(blockIndex, offset);
			lastUndoBatchKey = key;
			batchBlockIndex = blockIndex;
			needsUndoCheckpoint = false;
		}
		batchByteLength++;
		if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
		undoDebounceTimer = setTimeout(() => {
			needsUndoCheckpoint = true;
			undoDebounceTimer = null;
			flushPendingInputBatch();
		}, UNDO_DEBOUNCE_MS);
	}

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
		  };

	async function __commit(args: CommitArgs): Promise<void> {
		deps.stickyColumn.reset();
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
			flushPendingInputBatch();
		}

		if (args.snapshot !== 'skip') {
			pushUndoSnapshot(args.snapshot.blockIndex, args.snapshot.offset);
		}
		needsUndoCheckpoint = true;

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
			// some distant undo.
			const undoStack = deps.undoManager.getStacks().undo;
			assertUndoTopIntegrity(undoStack[undoStack.length - 1]);
		}

		if (args.op) {
			// Cast: the centralized emitter sees `kind: OperationKind` and `detail: Record<string, unknown> | undefined`,
			// which TS can't narrow into the per-arm shapes of EditEvent. Subscribers still get a discriminated union.
			deps.events.emit('edit', {
				op: args.op.kind,
				path: args.eventPath,
				detail: args.op.detail,
				timestamp: Date.now()
			} as EditEvent);
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

	/**
	 * Container-scoped commit wrapper. The primitive owns copy-path-on-write:
	 * it unshares the spine to `path`, hands `mutate` the OWNED container with
	 * its working children array already attached, then syncs childIds/refs
	 * from the returned StructuralChange and rebuilds the spine's raws.
	 * childIds are written on the owned node (NOT through the state bundle —
	 * the bundle's setter targets the component's still-stale node prop, which
	 * the snapshot shares).
	 */
	async function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void> {
		const { containerNode, path, state, snapshot, mutate, op, afterTick } = args;
		let owned = containerNode;
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				assertInvariant('container-commit-path', () =>
					nodeAt(deps.doc, path) === containerNode
						? null
						: {
								code: 'container-commit-path',
								message: `commitContainerStructural: path [${path.join(',')}] does not resolve to containerNode (${containerNode.kind})`
							}
				);
				const chain = ensureUnsharedPath(deps.doc, path, deps.sharing);
				owned = chain[chain.length - 1] ?? containerNode;
				const idsCopy = [...(owned.childIds ?? [])];
				const refsCopy = [...state.innerBlockRefs];
				// Fresh working array assigned through the node, then re-read —
				// write-then-re-read contract (tree-operations/unshare.ts header).
				owned.children = [...(owned.children ?? [])];
				const children = owned.children!;
				const change = mutate({ node: owned, children, sharing: deps.sharing });
				applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);
				owned.childIds = idsCopy;
				state.innerBlockRefs = refsCopy;
				rebuildUnsharedChain(chain, deps.sharing);
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick,
			touchedNodes: () => [owned]
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

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
	async function commitMultiScope(args: CommitMultiScopeArgs): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick } = args;
		let ownedNodes: CstNode[] = [];
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				const perScope = scopes.map((s) => {
					const isDoc = (s.node as unknown) === (deps.doc as unknown);
					if (!isDoc) {
						// A stale-but-in-range path would unshare and rebuild the wrong spine.
						assertInvariant('multi-scope-commit-path', () =>
							nodeAt(deps.doc, s.path) === s.node
								? null
								: {
										code: 'multi-scope-commit-path',
										message: `commitMultiScope: path [${s.path.join(',')}] does not resolve to scope node (${s.node.kind})`
									}
						);
					}
					const chain = isDoc ? [] : ensureUnsharedPath(deps.doc, s.path, deps.sharing);
					const owned = isDoc ? s.node : (chain[chain.length - 1] ?? s.node);
					const ids = isDoc ? [...s.state.innerBlockIds] : [...(owned.childIds ?? [])];
					const refs = [...s.state.innerBlockRefs];
					// Write-then-re-read contract (tree-operations/unshare.ts header).
					owned.children = [...(owned.children ?? [])];
					return { target: s, isDoc, chain, owned, children: owned.children!, ids, refs };
				});
				ownedNodes = perScope.map((p) => p.owned);

				const changes = mutate(
					perScope.map((p) => ({ children: p.children, node: p.owned })),
					deps.sharing
				);
				if (changes.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changes.length} changes for ${scopes.length} scopes`
					);
				}

				for (let i = 0; i < perScope.length; i++) {
					applyStructuralChangeToIdsRefs(changes[i], perScope[i].ids, perScope[i].refs);
				}

				for (const p of perScope) {
					// Doc-scope ids route through deps setters (top-level ids are
					// per-snapshot copies); container ids live on the owned node — the
					// state bundle's setter would write the stale shared node prop.
					if (p.isDoc) {
						p.target.state.innerBlockIds = p.ids;
					} else {
						p.owned.childIds = p.ids;
					}
					p.target.state.innerBlockRefs = p.refs;
				}

				// Deepest chains first: an inner scope's raw must be current before
				// an outer chain's rebuild concatenates it.
				for (const p of [...perScope].sort((a, b) => b.chain.length - a.chain.length)) {
					rebuildUnsharedChain(p.chain, deps.sharing);
				}
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick,
			// The doc scope's node has no block descriptor — exclude it from kind-keyed checks.
			touchedNodes: () => ownedNodes.filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined)
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/**
	 * Expose the document root as a MultiScopeTarget so cross-scope ops with
	 * an LCA at doc level can include it. The synthetic BlockListState forwards
	 * ids/refs through deps setters so publish-time assignments reach the
	 * Svelte $state proxies.
	 */
	function getDocScope(): MultiScopeTarget {
		return {
			node: deps.doc as unknown as CstNode,
			path: [],
			state: {
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
			}
		};
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

	function clearDebouncedCheckpoint(): void {
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
		}
		batchBlockIndex = -1;
		batchByteLength = 0;
		needsUndoCheckpoint = true;
	}

	return {
		sharing: deps.sharing,
		pushUndoSnapshot,
		pushUndoSnapshotDebounced,
		commitStructural,
		commitContainerStructural,
		commitMultiScope,
		getDocScope,
		captureCurrentState,
		collapsedSelectionAt,
		clearDebouncedCheckpoint
	};
}
