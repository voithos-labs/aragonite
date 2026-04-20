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
import type { OpDescriptor } from '../../debug/operations-log';

/**
 * Keystroke-batch window. 500 ms was too coarse — typing at 50–80 WPM
 * produces 4–7 characters per window, so Ctrl+Z reverted entire half-words.
 * 250 ms matches Obsidian's keystroke-batching more closely; VS Code /
 * Google Docs use word-boundary detection instead of a fixed window, which
 * is a potential further refinement (flush on space/punctuation).
 */
const UNDO_DEBOUNCE_MS = 250;

export function createUndoController(deps: EditorActionsDeps): UndoController {
	let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastUndoBlockIndex = -1;
	// When true, the next keystroke should capture a "before" snapshot.
	let needsUndoCheckpoint = true;

	// ── Selection helpers ─────────────────────────────────────────────────────

	function collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection {
		const point: SelectionPoint = { path: [blockIndex], offset };
		return { anchor: point, focus: point };
	}

	// ── Snapshot pushers ─────────────────────────────────────────────────────

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		const selection = deps.selectionState.isCrossBlock
			? readCurrentSelection(deps.selectionState, deps.blockRefs, collapsedSelectionAt)
			: collapsedSelectionAt(blockIndex, offset);
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
			needsUndoCheckpoint = false;
		}

			if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
		undoDebounceTimer = setTimeout(() => {
			needsUndoCheckpoint = true;
			undoDebounceTimer = null;
		}, UNDO_DEBOUNCE_MS);
	}

	// ── Internal commit primitive ────────────────────────────────────────────
	/**
	 * Universal commit ceremony: snapshot push, mutation on copies, atomic
	 * publish via kind-specific callback, op-log record, edit event emission,
	 * tick, post-tick callback. The public wrappers (`commitStructural`;
	 * `commitContainerStructural` added in T10) delegate here.
	 */

	interface CommitArgs {
		kind: 'document' | 'container';
		snapshot: { blockIndex: number; offset: number } | 'skip';
		mutate: (
			children: CstNode[],
			ids: string[],
			refs: (BlockComponent | undefined)[]
		) => void;
		publish: (
			children: CstNode[],
			ids: string[],
			refs: (BlockComponent | undefined)[]
		) => void;
		op?: OpDescriptor;
		eventPath: number[];
		afterTick?: () => void;
	}

	async function __commit(args: CommitArgs): Promise<void> {
		deps.stickyColumn.reset();
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
		}

		if (args.snapshot !== 'skip') {
			pushUndoSnapshot(args.snapshot.blockIndex, args.snapshot.offset);
		}
		needsUndoCheckpoint = true;

		// Document scope works on the live doc.children; container scope will
		// supply its own source in T10. For now only 'document' is reachable.
		const srcChildren = args.kind === 'document' ? deps.doc.children : [];
		const childrenCopy = [...srcChildren];
		const idsCopy = [...deps.blockIds];
		const refsCopy = [...deps.blockRefs];
		args.mutate(childrenCopy, idsCopy, refsCopy);

		args.publish(childrenCopy, idsCopy, refsCopy);

		if (deps.operationsLog && args.op) {
			deps.operationsLog.record({
				op: args.op.kind,
				path: args.eventPath,
				detail: args.op.detail ?? {}
			});
		}

		if (args.op) {
			// Emit the corresponding EditEvent. The detail shape per op is a
			// discriminated-union member; the `as any` bridges the union
			// narrowing the caller has already validated.
			const detail = args.op.detail ?? {};
			deps.events.emit('edit', {
				op: args.op.kind,
				path: args.eventPath,
				detail,
				timestamp: Date.now()
			} as never);
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
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void,
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
				deps.setDocChildren(children);
				deps.setBlockIds(ids);
				deps.setBlockRefs(refs);
			},
			op: options?.op,
			eventPath: [snapshotBlockIndex],
			afterTick
		});
	}

	// ── State capture / checkpoint control ──────────────────────────────────

	function captureCurrentState(): UndoEntry {
		return {
			snapshot: cloneDocument(deps.doc),
			blockIds: [...deps.blockIds],
			selection: readCurrentSelection(deps.selectionState, deps.blockRefs, collapsedSelectionAt)
		};
	}

	function clearDebouncedCheckpoint(): void {
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
		}
		needsUndoCheckpoint = true;
	}

	return {
		pushUndoSnapshot,
		pushUndoSnapshotDebounced,
		commitStructural,
		captureCurrentState,
		collapsedSelectionAt,
		clearDebouncedCheckpoint
	};
}
