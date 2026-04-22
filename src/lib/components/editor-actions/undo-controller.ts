/**
 * Undo/snapshot controller. Owns the keystroke-debounce timer and the
 * "needs new checkpoint" flag; exposes snapshot pushers and commit
 * primitives that wrap structural mutations with undo + reactivity ceremony.
 */

import { tick } from 'svelte';
import type {
	BlockComponent,
	CstNode,
	EditorSelection,
	SelectionPoint,
	UndoEntry
} from '../../contracts';
import { cloneDocument } from '../../tree-operations/clone';
import { readCurrentSelection } from '../../selection/native-bridge';
import type { EditorActionsDeps, UndoController } from './deps';
import type { OpDescriptor, OperationKind } from '../../debug/operations-log';
import type { EditEvent } from '../../events/editor-events';
import type { StructuralChange } from '../../tree-operations/structural-change';
import { generateBlockId } from '../../tree-operations/block-id';
import type { BlockListState } from '../blocks/container-state/block-list-state.svelte';

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

// ── StructuralChange applicator ──────────────────────────────────────────────

/**
 * Re-shape the parallel ids/refs arrays to match the mutated children.
 * Inserts get fresh IDs + undefined refs; `idMap` on replace preserves
 * specified old-index IDs for split/merge semantics.
 */
export function applyStructuralChangeToIdsRefs(
	change: StructuralChange,
	ids: string[],
	refs: (BlockComponent | undefined)[]
): void {
	switch (change.op) {
		case 'noop':
			return;
		case 'insert': {
			const newIds = Array.from({ length: change.count }, generateBlockId);
			const newRefs = new Array<BlockComponent | undefined>(change.count).fill(undefined);
			ids.splice(change.at, 0, ...newIds);
			refs.splice(change.at, 0, ...newRefs);
			return;
		}
		case 'delete': {
			ids.splice(change.at, change.count);
			refs.splice(change.at, change.count);
			return;
		}
		case 'replace': {
			const oldIds = ids.slice(change.at, change.at + change.count);
			const oldRefs = refs.slice(change.at, change.at + change.count);
			const idMap = change.idMap ?? {};
			const newIds = Array.from({ length: change.newCount }, (_, i) =>
				idMap[i] !== undefined ? oldIds[idMap[i]] : generateBlockId()
			);
			const newRefs = Array.from({ length: change.newCount }, (_, i) =>
				idMap[i] !== undefined ? oldRefs[idMap[i]] : undefined
			);
			ids.splice(change.at, change.count, ...newIds);
			refs.splice(change.at, change.count, ...newRefs);
			return;
		}
	}
}

export function createUndoController(deps: EditorActionsDeps): UndoController {
	let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastUndoBlockIndex = -1;
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

	// ── Snapshot pushers ─────────────────────────────────────────────────────

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		const selection =
			(deps.selectionState.isCrossBlock
				? readCurrentSelection(deps.selectionState, deps.blockRefs, collapsedSelectionAt)
				: collapsedSelectionAt(blockIndex, offset)) ?? collapsedSelectionAt(blockIndex, offset);
		deps.undoManager.push({
			snapshot: cloneDocument(deps.doc),
			blockIds: [...deps.blockIds],
			selection
		});
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
	function pushUndoSnapshotDebounced(blockIndex: number, offset: number): void {
		if (lastUndoBlockIndex !== blockIndex || needsUndoCheckpoint) {
			pushUndoSnapshot(blockIndex, offset);
			lastUndoBlockIndex = blockIndex;
			batchBlockIndex = blockIndex;
			batchByteLength = 0;
			needsUndoCheckpoint = false;
		}
		batchByteLength++;
		if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
		undoDebounceTimer = setTimeout(() => {
			needsUndoCheckpoint = true;
			undoDebounceTimer = null;
			if (batchByteLength > 0 && batchBlockIndex >= 0) {
				deps.events.emit('edit', {
					op: 'input',
					path: [batchBlockIndex],
					detail: { byteLength: batchByteLength },
					timestamp: Date.now()
				});
				batchBlockIndex = -1;
				batchByteLength = 0;
			}
		}, UNDO_DEBOUNCE_MS);
	}

	// ── Internal commit primitive ────────────────────────────────────────────
	/**
	 * Universal commit ceremony: snapshot push, mutation on copies, atomic
	 * publish, edit event emission, tick, post-tick callback. Public wrappers
	 * (`commitStructural`, `commitContainerStructural`) delegate here.
	 */

	interface CommitArgs {
		kind: 'document' | 'container';
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
	}

	async function __commit(args: CommitArgs): Promise<void> {
		deps.stickyColumn.reset();
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
			batchBlockIndex = -1;
			batchByteLength = 0;
		}

		if (args.snapshot !== 'skip') {
			pushUndoSnapshot(args.snapshot.blockIndex, args.snapshot.offset);
		}
		needsUndoCheckpoint = true;

		const srcChildren = args.kind === 'document' ? deps.doc.children : [];
		const childrenCopy = [...srcChildren];
		const idsCopy = [...deps.blockIds];
		const refsCopy = [...deps.blockRefs];

		const change = args.mutate(childrenCopy);
		applyStructuralChangeToIdsRefs(change, idsCopy, refsCopy);

		args.publish(childrenCopy, idsCopy, refsCopy);

		if (args.op) {
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
	/** `skipSnapshot` lets composite operations share a single undo entry. */

	async function commitStructural(
		snapshotBlockIndex: number,
		snapshotOffset: number,
		mutate: (children: CstNode[]) => StructuralChange,
		afterTick?: () => void,
		options?: { skipSnapshot?: boolean; op?: OpDescriptor }
	): Promise<void> {
		await __commit({
			kind: 'document',
			snapshot: options?.skipSnapshot
				? 'skip'
				: { blockIndex: snapshotBlockIndex, offset: snapshotOffset },
			mutate,
			publish: (children, ids, refs) => {
				deps.doc.children = children;
				deps.setBlockIds(ids);
				deps.setBlockRefs(refs);
			},
			op: options?.op,
			eventPath: [snapshotBlockIndex],
			afterTick
		});
	}

	/**
	 * Container-scoped commit wrapper. Mutation applies to the container's
	 * children; publish writes `node.children` + the state bundle's ids/refs.
	 * Ancestry raw rebuild lives inside `mutate` — the caller owns it so the
	 * atomic publish sees a rebuilt tree.
	 */
	async function commitContainerStructural(
		containerNode: CstNode,
		state: {
			innerBlockIds: string[];
			innerBlockRefs: (BlockComponent | undefined)[];
		},
		snapshot: { blockIndex: number; offset: number } | 'skip',
		mutate: (children: CstNode[]) => StructuralChange,
		afterTick?: () => void,
		op?: {
			kind: OpDescriptor['kind'];
			detail?: OpDescriptor['detail'];
			eventPath: number[];
		}
	): Promise<void> {
		// The container path applies the descriptor inside its custom mutate that
		// reaches into the container node + state bundle. The outer __commit's
		// mutate is used purely for snapshot/event ceremony; its StructuralChange
		// return is 'noop' because effects were already applied to inner state.
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
				return { op: 'noop' };
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick
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
	async function commitMultiScope(
		scopes: MultiScopeTarget[],
		snapshot: { blockIndex: number; offset: number } | 'skip',
		mutate: (scopeChildren: MultiScopeMutable[]) => StructuralChange[],
		op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] },
		afterTick?: () => void
	): Promise<void> {
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

				return { op: 'noop' };
			},
			publish: () => {
				// Nudge top-level reactivity so ancestor-raw mutations propagate.
				deps.doc.children = [...deps.doc.children];
			},
			op: op ? { kind: op.kind, detail: op.detail } : undefined,
			eventPath: op?.eventPath ?? [],
			afterTick
		});
	}

	// ── Doc scope adapter ────────────────────────────────────────────────────

	/**
	 * Expose the document root as a MultiScopeTarget so cross-scope ops with
	 * an LCA at doc level can include it. The synthetic BlockListState forwards
	 * ids/refs through deps setters so publish-time assignments reach the
	 * Svelte $state proxies. `commitChildrenEdit` is unused and throws.
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
				},
				commitChildrenEdit: () => {
					throw new Error('doc scope: commitChildrenEdit is not supported');
				}
			}
		};
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		const selection = readCurrentSelection(
			deps.selectionState,
			deps.blockRefs,
			collapsedSelectionAt
		);
		// Sentinel for the unfocused-at-capture edge case (headless harness,
		// programmatic capture) — keeps the UndoEntry shape valid.
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
