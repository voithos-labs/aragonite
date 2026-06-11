/**
 * Undo/snapshot controller. Owns the keystroke-debounce timer and the
 * "needs new checkpoint" flag; exposes snapshot pushers and commit
 * primitives that wrap structural mutations with undo + reactivity ceremony.
 */

import { tick } from 'svelte';
import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import type { EditorSelection } from '../editor-keys';
import type { UndoEntry } from '../undo/types';
import type { SelectionPoint } from '../selection/primitives';
import { cloneDocument } from '../tree-operations/clone';
import { readCurrentSelection } from '../selection/native-bridge';
import { pathsEqual } from '../selection/path-math';
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
import { assertCommittedNodes } from '../invariants/install';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { docByteLength, perfEnabled, recordSnapshotClone, setUndoGauge } from '../perf/instruments';

// ── Multi-scope commit types ──────────────────────────────────────────────────

/**
 * Order matters for the emitted event path — scopes[0] is the outermost.
 */
export interface MultiScopeTarget {
	node: CstNode;
	state: BlockListState;
}

/**
 * Mutable view of one scope. Return a StructuralChange[] (one per scope,
 * same order); the primitive applies descriptors to ids/refs.
 */
export interface MultiScopeMutable {
	children: CstNode[];
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
			snapshot: cloneDocument(deps.doc),
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
			snapshot: cloneDocument(deps.doc),
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
				/** Directly-mutated containers (innermost scopes) for the dev invariant check. */
				touchedNodes?: CstNode[];
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
				assertCommittedNodes(touchedContainersWithChildren(args.touchedNodes));
			}
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
	 * Container-scoped commit wrapper. Mutation applies to the container's
	 * children; publish writes `node.children` + the state bundle's ids/refs.
	 * Ancestry raw rebuild lives inside `mutate` — the caller owns it so the
	 * atomic publish sees a rebuilt tree.
	 */
	async function commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void> {
		const { containerNode, state, snapshot, mutate, op, afterTick } = args;
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				const childrenCopy = [...(containerNode.children ?? [])];
				const idsCopy = [...state.innerBlockIds];
				const refsCopy = [...state.innerBlockRefs];
				const change = mutate(childrenCopy);
				applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);
				containerNode.children = childrenCopy;
				state.innerBlockIds = idsCopy;
				state.innerBlockRefs = refsCopy;
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick,
			touchedNodes: [containerNode]
		});
	}

	// ── Multi-scope structural commit ────────────────────────────────────────

	/**
	 * Atomic structural commit spanning multiple container scopes — one undo
	 * snapshot, per-scope children views, one edit event. Use for operations
	 * touching ≥2 container nodes (e.g., indent across parent + nested list).
	 *
	 * Gotcha: rebuild helpers like `rebuildListRaw` read `node.children`
	 * directly. If `mutate` calls a rebuild helper before the atomic publish,
	 * sync `scope.node.children = scopeChildren[i].children` first — otherwise
	 * the rebuild sees the pre-mutation tree. See `list-context.ts` /
	 * `nested-actions.ts` for the sync-before-rebuild pattern.
	 */
	async function commitMultiScope(args: CommitMultiScopeArgs): Promise<void> {
		const { scopes, snapshot, mutate, op, afterTick } = args;
		await __commit({
			kind: 'container',
			snapshot,
			mutate: () => {
				// Per-scope copies — mutate operates on these, never on live state.
				const perScope = scopes.map((s) => ({
					target: s,
					children: [...(s.node.children ?? [])],
					ids: [...s.state.innerBlockIds],
					refs: [...s.state.innerBlockRefs]
				}));

				const changes = mutate(perScope.map((p) => ({ children: p.children })));
				if (changes.length !== scopes.length) {
					throw new Error(
						`commitMultiScope: mutate returned ${changes.length} changes for ${scopes.length} scopes`
					);
				}

				for (let i = 0; i < perScope.length; i++) {
					applyStructuralChangeToIdsRefs(changes[i], perScope[i].ids, perScope[i].refs);
				}

				// Atomic publish: assign all scopes before Svelte observes a change.
				for (const p of perScope) {
					p.target.node.children = p.children;
					p.target.state.innerBlockIds = p.ids;
					p.target.state.innerBlockRefs = p.refs;
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
			touchedNodes: scopes
				.map((s) => s.node)
				.filter((n) => tryGetBlockKindDescriptor(n.kind) !== undefined)
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
			snapshot: cloneDocument(deps.doc),
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
