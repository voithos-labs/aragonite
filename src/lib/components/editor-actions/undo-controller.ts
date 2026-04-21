/**
 * Undo/snapshot controller for the editor. Owns the keystroke-debounce
 * timer and the "needs new checkpoint" flag, exposes snapshot pushers,
 * and wraps structural mutations with the full undo + commit ceremony.
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
 * Target scope for commitMultiScope: a container node + its registered
 * BlockListState. Order matters for the emitted event path — scopes[0] is
 * the outermost scope conceptually.
 */
export interface MultiScopeTarget {
	node: CstNode;
	state: BlockListState;
}

/**
 * Mutable view of one scope during a multi-scope commit. Mutate `children`
 * per 0.5.5.1; return a StructuralChange[] (one per scope, same order) from
 * the mutate callback — the primitive applies descriptors to ids/refs.
 */
export interface MultiScopeMutable {
	children: CstNode[];
}

/**
 * Keystroke-batch window. 500 ms was too coarse — typing at 50–80 WPM
 * produces 4–7 characters per window, so Ctrl+Z reverted entire half-words.
 * 250 ms matches Obsidian's keystroke-batching more closely; VS Code /
 * Google Docs use word-boundary detection instead of a fixed window, which
 * is a potential further refinement (flush on space/punctuation).
 */
const UNDO_DEBOUNCE_MS = 250;

// ── StructuralChange applicator ──────────────────────────────────────────────

/**
 * Apply a StructuralChange to the parallel ids + refs arrays so their shape
 * matches the mutated children array. Inserted slots get fresh IDs and
 * undefined ref placeholders; deleted slots are removed; `idMap` on replace
 * preserves specified old-index IDs for split/merge semantics.
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
	// When true, the next keystroke should capture a "before" snapshot.
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

	/** Capture a "before" snapshot on the first keystroke of each batch; reset debounce on subsequent ones. */
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
			// Batch flushed — emit one input event summarizing it.
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
	 * publish via kind-specific callback, edit event emission, tick, post-tick
	 * callback. The public wrappers (`commitStructural`,
	 * `commitContainerStructural`) delegate here. Op-log recording is wired
	 * externally via an `events.on('edit', ...)` subscription in Editor.svelte.
	 */

	interface CommitArgs {
		kind: 'document' | 'container';
		snapshot: { blockIndex: number; offset: number } | 'skip';
		/**
		 * Mutate `children` in place (per 0.5.5.1) and return a StructuralChange
		 * describing the array-shape mutation. The commit primitive auto-syncs
		 * `ids` and `refs` from the descriptor — do NOT splice them inside the
		 * mutate callback. Side effects (raw rebuild, inline reparse, etc.) are
		 * allowed; they don't affect the ids/refs sync.
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
			// detail is carried verbatim from the op descriptor (the 0.5.5.4 fix).
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
	/**
	 * Wrap a structural mutation: clear debounce, push snapshot, apply mutation
	 * on array copies, publish atomically, tick, run post-tick callback.
	 * `skipSnapshot` lets composite operations share a single undo entry.
	 */

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
	 * Container-scoped commit wrapper. Mutation is applied to the container
	 * node's children; publish re-spreads `node.children` in place plus the
	 * container's `BlockListState.innerBlockIds`. Ancestry raw rebuild runs
	 * inside `mutate` — the caller owns it so the atomic publish sees a
	 * rebuilt tree.
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
		// The container path applies the descriptor INSIDE its custom mutate that
		// reaches into the container node + state bundle. The outer __commit's
		// mutate parameter is used purely for the snapshot/event ceremony; its
		// StructuralChange return is 'noop' because the descriptor's effects were
		// already applied to the inner state via applyStructuralChangeToIdsRefs.
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
	 * Structural commit spanning multiple container scopes atomically. Pushes
	 * ONE undo snapshot, calls `mutate` with per-scope children views, applies
	 * the returned StructuralChange[] to each scope's ids/refs, then publishes
	 * all scopes at once before emitting a single edit event.
	 *
	 * Use this for operations that must mutate ≥2 container nodes (e.g.,
	 * indent/unindent across a list + parent list). Single-scope mutations
	 * should continue to use commitContainerStructural.
	 */
	async function commitMultiScope(
		scopes: MultiScopeTarget[],
		snapshot: { blockIndex: number; offset: number } | 'skip',
		mutate: (scopeChildren: MultiScopeMutable[]) => StructuralChange[],
		op?: { kind: OperationKind; detail?: Record<string, unknown>; eventPath: number[] },
		afterTick?: () => void
	): Promise<void> {
		deps.stickyColumn.reset();
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
			batchBlockIndex = -1;
			batchByteLength = 0;
		}

		if (snapshot !== 'skip') {
			pushUndoSnapshot(snapshot.blockIndex, snapshot.offset);
		}
		needsUndoCheckpoint = true;

		// Per-scope copies — mutate callback operates on these, never on live state.
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

		// Atomic publish: assign all scopes before Svelte sees any change.
		for (const p of perScope) {
			p.target.node.children = p.children;
			p.target.state.innerBlockIds = p.ids;
			p.target.state.innerBlockRefs = p.refs;
		}

		// Nudge top-level reactivity so ancestor-raw mutations propagate.
		deps.doc.children = [...deps.doc.children];

		if (op) {
			deps.events.emit('edit', {
				op: op.kind,
				path: op.eventPath,
				detail: op.detail,
				timestamp: Date.now()
			} as EditEvent);
		}

		await tick();
		afterTick?.();
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		const selection = readCurrentSelection(
			deps.selectionState,
			deps.blockRefs,
			collapsedSelectionAt
		);
		// When no block reports a cursor (editor unfocused at capture time), fall
		// back to a collapsed sentinel at doc path [0] offset 0. captureCurrentState
		// is only called at redo-stack push time — in practice some block IS
		// focused then, but the sentinel keeps the UndoEntry shape valid even in
		// edge cases (headless test harnesses, programmatic capture).
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
		captureCurrentState,
		collapsedSelectionAt,
		clearDebouncedCheckpoint
	};
}
