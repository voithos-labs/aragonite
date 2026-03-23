<script lang="ts">
	import { setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type BlockComponent,
		type Document,
		type UndoEntry
	} from '../editor-types';
	import { cloneDocument, serializeMutable, assignIds } from '../mutable-tree';
	import {
		splitNode as performSplit,
		mergeWithPrevious as performMerge,
		deleteNode as performDelete,
		updateNodeContent as performUpdate
	} from '../tree-operations';
	import { createUndoManager } from '../undo-manager';
	import { isMergeEligible, isBlockEditable } from '../merge-rules';
	import { parse } from '../core/parser';
	import BlockList from './BlockList.svelte';

	let { source = '' }: { source?: string } = $props();

	// ── State ───────────────────────────────────────────────────────────

	function initDocument(src: string): Document {
		const d = parse(src);
		// Ensure there's always at least one block to edit
		if (d.children.length === 0) {
			d.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
		return d;
	}

	let doc = $state<Document>(initDocument(source));
	let blockIds = $state<string[]>(assignIds(doc.children));
	let blockRefs = $state<(BlockComponent | undefined)[]>([]);
	const undoManager = createUndoManager();

	// ── Undo snapshot helpers ───────────────────────────────────────────

	let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastUndoBlockIndex = -1;
	// When true, the next keystroke should capture a "before" snapshot
	let needsUndoCheckpoint = true;

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		undoManager.push({
			snapshot: cloneDocument(doc),
			blockIds: [...blockIds],
			focusBlockIndex: blockIndex,
			focusOffset: offset
		});
	}

	/**
	 * Called before each edit. Captures a "before" snapshot on the first
	 * keystroke of a new batch. Subsequent keystrokes in the same batch
	 * just reset the debounce timer. When the timer fires (user paused),
	 * the next keystroke starts a new batch.
	 */
	function pushUndoSnapshotDebounced(blockIndex: number, offset: number): void {
		if (lastUndoBlockIndex !== blockIndex || needsUndoCheckpoint) {
			pushUndoSnapshot(blockIndex, offset);
			lastUndoBlockIndex = blockIndex;
			needsUndoCheckpoint = false;
		}

		// Reset debounce — when it fires, the next keystroke starts a new batch
		if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
		undoDebounceTimer = setTimeout(() => {
			needsUndoCheckpoint = true;
			undoDebounceTimer = null;
		}, 500);
	}

	function captureCurrentState(): UndoEntry {
		const focusedIndex = Math.max(
			0,
			blockRefs.findIndex((b) => b?.getCursorOffset?.() !== null)
		);
		const focusedOffset = blockRefs[focusedIndex]?.getCursorOffset?.() ?? 0;
		return {
			snapshot: cloneDocument(doc),
			blockIds: [...blockIds],
			focusBlockIndex: focusedIndex,
			focusOffset: focusedOffset
		};
	}

	// ── EditorActions ───────────────────────────────────────────────────

	const actions: EditorActions = {
		async splitBlock(blockIndex: number, offset: number): Promise<void> {
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, offset);
			needsUndoCheckpoint = true;
			performSplit(doc, blockIds, blockIndex, offset);
			// Trigger Svelte reactivity
			doc.children = [...doc.children];
			blockIds = [...blockIds];
			await tick();
			blockRefs[blockIndex + 1]?.focus?.(0);
		},

		async mergeWithPrevious(blockIndex: number): Promise<void> {
			if (blockIndex <= 0) return;

			const prevKind = doc.children[blockIndex - 1].kind;
			const currKind = doc.children[blockIndex].kind;

			if (!isMergeEligible(prevKind, currKind)) {
				if (!isBlockEditable(prevKind)) {
					// Previous block is non-editable — delete it
					if (undoDebounceTimer) {
						clearTimeout(undoDebounceTimer);
						undoDebounceTimer = null;
					}
					pushUndoSnapshot(blockIndex, 0);
					needsUndoCheckpoint = true;
					performDelete(doc, blockIds, blockIndex - 1);
					doc.children = [...doc.children];
					blockIds = [...blockIds];
					await tick();
					blockRefs[blockIndex - 1]?.focus?.(0);
				} else {
					// Previous block is editable but not mergeable — move focus
					blockRefs[blockIndex - 1]?.focus?.(999999);
				}
				return;
			}

			// Mergeable — proceed with merge
			const prevRaw = doc.children[blockIndex - 1].raw;
			let mergeOffset = prevRaw.length;
			if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
			else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, 0);
			needsUndoCheckpoint = true;
			performMerge(doc, blockIds, blockIndex);
			doc.children = [...doc.children];
			blockIds = [...blockIds];
			await tick();
			blockRefs[blockIndex - 1]?.focus?.(mergeOffset);
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, 0);
			needsUndoCheckpoint = true;
			performDelete(doc, blockIds, blockIndex);
			doc.children = [...doc.children];
			blockIds = [...blockIds];
			await tick();
			// Focus the block that took the deleted block's position, or the previous one
			const focusIndex = Math.min(blockIndex, doc.children.length - 1);
			if (focusIndex >= 0) {
				blockRefs[focusIndex]?.focus?.(0);
			}
		},

		async moveFocus(blockIndex: number, position: 'start' | 'end' | number): Promise<void> {
			if (blockIndex < 0 || blockIndex >= doc.children.length) return;
			const block = blockRefs[blockIndex];
			if (!block?.focusable) return;

			if (typeof position === 'number') {
				block.focus?.(position);
			} else if (position === 'start') {
				block.focus?.(0);
			} else {
				// 'end' — use a large number, focus() should clamp to content length
				block.focus?.(999999);
			}
		},

		updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void {
			pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			const result = performUpdate(doc, blockIndex, text);
			if (result.kindChanged) {
				doc.children = [...doc.children];
				// Re-focus after Svelte swaps the component type.
				// Use preEditOffset (the cursor position before the edit) to restore
				// the cursor approximately where it was.
				tick().then(() => {
					blockRefs[blockIndex]?.focus?.(preEditOffset ?? 0);
				});
			}
		},

		async requestUndo(): Promise<void> {
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			needsUndoCheckpoint = true;

			const entry = undoManager.undo(captureCurrentState());
			if (!entry) return;
			doc = entry.snapshot;
			blockIds = entry.blockIds;
			await tick();
			blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
		},

		async requestRedo(): Promise<void> {
			const entry = undoManager.redo(captureCurrentState());
			if (!entry) return;
			doc = entry.snapshot;
			blockIds = entry.blockIds;
			await tick();
			blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
		},

		beginContainerEdit(blockIndex: number, offset: number): void {
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, offset);
			needsUndoCheckpoint = true;
		},

		beginContainerEditDebounced(blockIndex: number, offset: number): void {
			pushUndoSnapshotDebounced(blockIndex, offset);
		},

		endContainerEdit(): void {
			doc.children = [...doc.children];
		}
	};

	setContext(EDITOR_ACTIONS_KEY, actions);

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serializeMutable(doc);
	}
</script>

<div class="editor">
	<BlockList children={doc.children} {blockIds} bind:blockRefs />
</div>

<style>
	.editor {
		width: 100%;
		flex: 1;
		padding: 1rem;
		font-family: var(--font-editor, system-ui, sans-serif);
		font-size: 1rem;
		line-height: 1.6;
		color: var(--color-text-primary);
		min-height: 200px;
		border: 1px solid var(--color-ui-muted, #333);
		border-radius: 4px;
	}
</style>
