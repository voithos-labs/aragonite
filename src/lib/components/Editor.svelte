<script lang="ts">
	import { setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		STICKY_COLUMN_KEY,
		CURSOR_END,
		type EditorActions,
		type FocusPosition,
		type BlockComponent,
		type CstNode,
		type Document,
		type UndoEntry
	} from '../editor-types';
	import { createStickyColumnState } from '../sticky-column';
	import { cloneDocument, serializeMutable, assignIds, generateBlockId } from '../mutable-tree';
	import { displayLength, trimTrailingLineEnding } from '../core/text-utils';
	import {
		splitNode as performSplit,
		mergeWithNext as performMergeNext,
		deleteNode as performDelete,
		updateNodeContent as performUpdate,
		ensureEditableContainers,
		rebuildAncestryRaw
	} from '../tree-operations';
	import { createUndoManager } from '../undo-manager';
	import { isMergeEligible, isBlockEditable, findMergeTarget } from '../merge-rules';
	import { parse } from '../core/parser';
	import { parseInline, getContentRange, isProseKind } from '../core/inline';
	import BlockList from './BlockList.svelte';

	let { source = '' }: { source?: string } = $props();

	// ── State ───────────────────────────────────────────────────────────

	function parseAllInlineContent(children: CstNode[]): void {
		for (const child of children) {
			if (isProseKind(child.kind)) {
				const range = getContentRange(child);
				child.inlineContent = parseInline(child.raw, range.start, range.end);
			}
			if (child.children) {
				parseAllInlineContent(child.children);
			}
		}
	}

	function initDocument(src: string): Document {
		const d = parse(src);
		// Ensure there's always at least one block to edit
		if (d.children.length === 0) {
			d.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
		// Ensure every container has at least one child (editing surface)
		for (const child of d.children) {
			ensureEditableContainers(child);
		}
		parseAllInlineContent(d.children);
		return d;
	}

	let doc = $state<Document>(initDocument(source));
	let blockIds = $state<string[]>(assignIds(doc.children));
	let blockRefs = $state<(BlockComponent | undefined)[]>([]);
	let editorEl: HTMLDivElement | undefined = $state();
	const undoManager = createUndoManager();
	const stickyColumn = createStickyColumnState();

	// Re-initialize when source prop changes (e.g., async document load)
	let lastSource = source;
	$effect(() => {
		if (source !== lastSource) {
			lastSource = source;
			doc = initDocument(source);
			blockIds = assignIds(doc.children);
			blockRefs = [];
			undoManager.clear();
			stickyColumn.reset();
		}
	});

	$effect(() => {
		const handleFocusOut = (e: FocusEvent) => {
			// focusout bubbles; reset only if focus is leaving the editor entirely.
			// If the relatedTarget is inside editorEl, the focus is just moving
			// between blocks and we should not reset.
			if (!editorEl) return;
			const next = e.relatedTarget as Node | null;
			if (next && editorEl.contains(next)) return;
			stickyColumn.reset();
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				stickyColumn.reset();
			}
		};

		if (editorEl) {
			editorEl.addEventListener('focusout', handleFocusOut);
		}
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			if (editorEl) {
				editorEl.removeEventListener('focusout', handleFocusOut);
			}
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

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
			blockRefs.findIndex((b) => b?.getCursorOffset() !== null)
		);
		const focusedOffset = blockRefs[focusedIndex]?.getCursorOffset() ?? 0;
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
			stickyColumn.reset();
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, offset);
			needsUndoCheckpoint = true;
			// Work on plain array copies to prevent $state proxy splice mutations
			// from triggering intermediate reactive updates that corrupt the keyed
			// {#each} component-to-index mapping.
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			performSplit({ children: childrenCopy }, idsCopy, blockIndex, offset);
			// Sync blockRefs: insert undefined slot for the new block.
			// bind:ref in keyed {#each} only fires on mount, not when components
			// shift positions, so we must manually keep refs aligned.
			const refsCopy = [...blockRefs];
			refsCopy.splice(blockIndex + 1, 0, undefined);
			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;
			await tick();
			blockRefs[blockIndex + 1]?.focus(0);
		},

		async insertParsedBlocks(blockIndex: number, offset: number, blocks: CstNode[]): Promise<void> {
			stickyColumn.reset();
			if (blocks.length === 0) return;

			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, offset);
			needsUndoCheckpoint = true;

			const currentNode = doc.children[blockIndex];
			const rawText = currentNode.raw;
			const lineEnding = rawText.endsWith('\r\n') ? '\r\n' : '\n';

			// Split the current block's raw at offset into before/after
			const rawBefore = rawText.slice(0, offset);
			const rawAfter = trimTrailingLineEnding(rawText.slice(offset));

			const newNodes: CstNode[] = [];

			// If there's text before the cursor, it becomes the first block
			if (rawBefore.length > 0) {
				const beforeRaw = rawBefore + lineEnding;
				const beforeDoc = parse(beforeRaw);
				const beforeNode =
					beforeDoc.children.length > 0
						? beforeDoc.children[0]
						: { kind: 'paragraph' as const, leadingTrivia: '', raw: beforeRaw };
				beforeNode.leadingTrivia = currentNode.leadingTrivia;
				ensureEditableContainers(beforeNode);
				newNodes.push(beforeNode);
			}

			// Add all pasted blocks except the last
			for (let i = 0; i < blocks.length - 1; i++) {
				const node = { ...blocks[i] };
				if (newNodes.length === 0) {
					node.leadingTrivia = currentNode.leadingTrivia;
				}
				ensureEditableContainers(node);
				newNodes.push(node);
			}

			// Last pasted block gets rawAfter appended
			const lastPasted = blocks[blocks.length - 1];
			const mergedLastRaw = trimTrailingLineEnding(lastPasted.raw) + rawAfter + lineEnding;
			const lastDoc = parse(mergedLastRaw);
			const lastNode =
				lastDoc.children.length > 0
					? lastDoc.children[0]
					: { kind: 'paragraph' as const, leadingTrivia: '', raw: mergedLastRaw };
			if (newNodes.length === 0) {
				lastNode.leadingTrivia = currentNode.leadingTrivia;
			} else {
				lastNode.leadingTrivia = '';
			}
			ensureEditableContainers(lastNode);
			newNodes.push(lastNode);

			// Parse inline content for all new nodes
			parseAllInlineContent(newNodes);

			// Work on plain copies to prevent proxy splice cascades
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			const refsCopy = [...blockRefs];

			// Replace the original block with new nodes
			childrenCopy.splice(blockIndex, 1, ...newNodes);

			// Update blockIds: keep original ID for first, generate new for the rest
			const newIds = newNodes.slice(1).map(() => generateBlockId());
			idsCopy.splice(blockIndex + 1, 0, ...newIds);

			// Sync refs: replace one slot with N undefined slots
			const newRefSlots: (BlockComponent | undefined)[] = new Array(newNodes.length).fill(
				undefined
			);
			newRefSlots[0] = refsCopy[blockIndex]; // keep existing ref for first node
			refsCopy.splice(blockIndex, 1, ...newRefSlots);

			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;

			await tick();

			// Focus at end of last inserted node
			const lastIndex = blockIndex + newNodes.length - 1;
			blockRefs[lastIndex]?.focus(CURSOR_END);
		},

		async replaceBlock(
			blockIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			stickyColumn.reset();
			if (blockIndex < 0 || blockIndex >= doc.children.length) return;

			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, focus?.offset ?? 0);
			needsUndoCheckpoint = true;

			// Work on plain copies to prevent $state proxy splice cascades.
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			const refsCopy = [...blockRefs];

			if (replacement.length === 0) {
				// Degenerate case: delete the block.
				childrenCopy.splice(blockIndex, 1);
				idsCopy.splice(blockIndex, 1);
				refsCopy.splice(blockIndex, 1);
			} else {
				// Preserve leading trivia of the original block on the first replacement.
				const originalTrivia = doc.children[blockIndex].leadingTrivia;
				const normalizedReplacement = replacement.map((node, i) => {
					const copy = { ...node };
					copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
					ensureEditableContainers(copy);
					return copy;
				});

				// Parse inline content for any prose-kind replacement blocks.
				parseAllInlineContent(normalizedReplacement);

				childrenCopy.splice(blockIndex, 1, ...normalizedReplacement);

				// IDs: fresh for each replacement block.
				const newIds = normalizedReplacement.map(() => generateBlockId());
				idsCopy.splice(blockIndex, 1, ...newIds);

				// Refs: new undefined slots for each replacement block.
				const newRefSlots: (BlockComponent | undefined)[] = new Array(
					normalizedReplacement.length
				).fill(undefined);
				refsCopy.splice(blockIndex, 1, ...newRefSlots);
			}

			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;

			await tick();

			if (focus && replacement.length > 0) {
				const targetIndex = blockIndex + focus.replacementIndex;
				blockRefs[targetIndex]?.focus(focus.offset);
			}
		},

		async mergeWithPrevious(blockIndex: number): Promise<void> {
			stickyColumn.reset();
			if (blockIndex <= 0) return;

			const prev = doc.children[blockIndex - 1];
			const curr = doc.children[blockIndex];
			const prevKind = prev.kind;
			const currKind = curr.kind;

			if (!isMergeEligible(prevKind, currKind)) {
				if (!isBlockEditable(prevKind)) {
					// Previous block is non-editable — delete it
					if (undoDebounceTimer) {
						clearTimeout(undoDebounceTimer);
						undoDebounceTimer = null;
					}
					pushUndoSnapshot(blockIndex, 0);
					needsUndoCheckpoint = true;
					const childrenCopy = [...doc.children];
					const idsCopy = [...blockIds];
					const refsCopy = [...blockRefs];
					performDelete({ children: childrenCopy }, idsCopy, blockIndex - 1);
					refsCopy.splice(blockIndex - 1, 1);
					doc.children = childrenCopy;
					blockIds = idsCopy;
					blockRefs = refsCopy;
					await tick();
					blockRefs[blockIndex - 1]?.focus(0);
				} else {
					// Previous block is editable but not mergeable — move focus
					blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				}
				return;
			}

			// Eligible — resolve the actual merge target. For prose/prose-absorber
			// prev this is prev itself (empty path). For container prev this is
			// the deepest prose leaf inside prev (non-empty path).
			const mergeTarget = findMergeTarget(prev);
			if (!mergeTarget) {
				// Walker couldn't find a prose leaf (e.g. container's deepest leaf
				// is opaque). Same fallback as ineligible — move focus.
				blockRefs[blockIndex - 1]?.focus(CURSOR_END);
				return;
			}

			// Mutate the target's raw and track the join offset for cursor placement.
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, 0);
			needsUndoCheckpoint = true;

			const target = mergeTarget.target;
			const targetRaw = target.raw ?? '';
			const currRaw = curr.raw ?? '';
			// Preserve the target's existing line ending style.
			const lineEnding = targetRaw.endsWith('\r\n') ? '\r\n' : '\n';
			const targetText = trimTrailingLineEnding(targetRaw);
			const currText = trimTrailingLineEnding(currRaw);
			const joinOffset = targetText.length;
			target.raw = targetText + currText + lineEnding;

			// Refresh the target's inline content cache. The per-input reactive
			// pipeline doesn't fire here because the user was typing in curr, not
			// in target — we must re-parse explicitly.
			if (isProseKind(target.kind)) {
				const range = getContentRange(target);
				target.inlineContent = parseInline(target.raw, range.start, range.end);
			}

			// Delete curr from top-level children / ids / refs.
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			const refsCopy = [...blockRefs];
			performDelete({ children: childrenCopy }, idsCopy, blockIndex);
			refsCopy.splice(blockIndex, 1);
			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;

			// Rebuild ancestry raw for container-target merges. For top-level prose
			// merges (empty path) there's no ancestry to rebuild — the target IS prev.
			if (mergeTarget.path.length > 0) {
				rebuildAncestryRaw(prev, mergeTarget.path);
			}

			await tick();

			// Focus cascade: for flat (prev === target) merges, focus prev directly.
			// For nested-target merges, use focusByPath to cascade down.
			if (mergeTarget.path.length === 0) {
				blockRefs[blockIndex - 1]?.focus(joinOffset);
			} else {
				blockRefs[blockIndex - 1]?.focusByPath?.(mergeTarget.path, joinOffset);
			}
		},

		async mergeWithNext(blockIndex: number): Promise<void> {
			stickyColumn.reset();
			if (blockIndex >= doc.children.length - 1) return;

			const currKind = doc.children[blockIndex].kind;
			const nextKind = doc.children[blockIndex + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					// Next block is non-editable — delete it
					if (undoDebounceTimer) {
						clearTimeout(undoDebounceTimer);
						undoDebounceTimer = null;
					}
					pushUndoSnapshot(blockIndex, CURSOR_END);
					needsUndoCheckpoint = true;
					const childrenCopy = [...doc.children];
					const idsCopy = [...blockIds];
					const refsCopy = [...blockRefs];
					performDelete({ children: childrenCopy }, idsCopy, blockIndex + 1);
					refsCopy.splice(blockIndex + 1, 1);
					doc.children = childrenCopy;
					blockIds = idsCopy;
					blockRefs = refsCopy;
					await tick();
					blockRefs[blockIndex]?.focus(CURSOR_END);
				} else {
					// Next block is editable but not mergeable — move focus
					blockRefs[blockIndex + 1]?.focus(0);
				}
				return;
			}

			// Mergeable — proceed with merge
			const mergeOffset = displayLength(doc.children[blockIndex].raw);

			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, CURSOR_END);
			needsUndoCheckpoint = true;
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			const refsCopy = [...blockRefs];
			performMergeNext({ children: childrenCopy }, idsCopy, blockIndex);
			refsCopy.splice(blockIndex + 1, 1); // Remove next block's ref
			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;
			await tick();
			blockRefs[blockIndex]?.focus(mergeOffset);
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			stickyColumn.reset();
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, 0);
			needsUndoCheckpoint = true;
			const childrenCopy = [...doc.children];
			const idsCopy = [...blockIds];
			const refsCopy = [...blockRefs];
			performDelete({ children: childrenCopy }, idsCopy, blockIndex);
			refsCopy.splice(blockIndex, 1);
			doc.children = childrenCopy;
			blockIds = idsCopy;
			blockRefs = refsCopy;
			await tick();
			// Focus the block that took the deleted block's position, or the previous one
			const focusIndex = Math.min(blockIndex, doc.children.length - 1);
			if (focusIndex >= 0) {
				blockRefs[focusIndex]?.focus(0);
			}
		},

		async moveFocus(blockIndex: number, position: FocusPosition): Promise<void> {
			if (blockIndex < 0) return;
			if (blockIndex >= doc.children.length) {
				// Past the last block — create a new empty paragraph
				const newBlock: CstNode = { kind: 'paragraph', leadingTrivia: '\n', raw: '\n' };
				doc.children = [...doc.children, newBlock];
				blockIds = [...blockIds, generateBlockId()];
				blockRefs = [...blockRefs, undefined];
				await tick();
				blockRefs[doc.children.length - 1]?.focus(0);
				return;
			}
			const block = blockRefs[blockIndex];
			if (!block?.focusable) return;

			if (typeof position === 'object' && 'stickyColumnFrom' in position) {
				// Sticky-column variant: dispatch to focusAtColumn? if available,
				// else fall back to focus(0) / focus(CURSOR_END) based on direction.
				const x = stickyColumn.get();
				const from = position.stickyColumnFrom;
				if (x !== null && block.focusAtColumn) {
					block.focusAtColumn(x, from);
					return;
				}
				block.focus(from === 'above' ? 0 : CURSOR_END);
				return;
			}

			if (typeof position === 'number') {
				block.focus(position);
			} else if (position === 'start') {
				block.focus(0);
			} else {
				// 'end' — use a large number, focus() should clamp to content length
				block.focus(CURSOR_END);
			}
		},

		updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void {
			stickyColumn.reset();
			pushUndoSnapshotDebounced(blockIndex, preEditOffset ?? 0);
			const result = performUpdate(doc, blockIndex, text);
			if (result.kindChanged) {
				doc.children = [...doc.children];
				// Re-focus after Svelte swaps the component type.
				// Use preEditOffset (the cursor position before the edit) to restore
				// the cursor approximately where it was.
				tick().then(() => {
					blockRefs[blockIndex]?.focus(preEditOffset ?? 0);
				});
			}
		},

		async requestUndo(): Promise<void> {
			stickyColumn.reset();
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			needsUndoCheckpoint = true;

			const entry = undoManager.undo(captureCurrentState());
			if (!entry) return;
			doc = entry.snapshot;
			parseAllInlineContent(doc.children);
			blockIds = entry.blockIds;
			await tick();
			blockRefs[entry.focusBlockIndex]?.focus(entry.focusOffset);
		},

		async requestRedo(): Promise<void> {
			stickyColumn.reset();
			const entry = undoManager.redo(captureCurrentState());
			if (!entry) return;
			doc = entry.snapshot;
			parseAllInlineContent(doc.children);
			blockIds = entry.blockIds;
			await tick();
			blockRefs[entry.focusBlockIndex]?.focus(entry.focusOffset);
		},

		beginContainerEdit(blockIndex: number, offset: number): void {
			stickyColumn.reset();
			if (undoDebounceTimer) {
				clearTimeout(undoDebounceTimer);
				undoDebounceTimer = null;
			}
			pushUndoSnapshot(blockIndex, offset);
			needsUndoCheckpoint = true;
		},

		beginContainerEditDebounced(blockIndex: number, offset: number): void {
			stickyColumn.reset();
			pushUndoSnapshotDebounced(blockIndex, offset);
		},

		endContainerEdit(): void {
			doc.children = [...doc.children];
		}
	};

	setContext(EDITOR_ACTIONS_KEY, actions);
	setContext(STICKY_COLUMN_KEY, stickyColumn);

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serializeMutable(doc);
	}
</script>

<div class="editor" bind:this={editorEl}>
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
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #444) transparent;
		border: 1px solid var(--color-ui-muted, #333);
		border-radius: 4px;
	}

	.editor::-webkit-scrollbar {
		width: 6px;
	}

	.editor::-webkit-scrollbar-track {
		background: transparent;
	}

	.editor::-webkit-scrollbar-thumb {
		background: var(--color-ui-muted, #444);
		border-radius: 3px;
	}

	.editor::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #666);
	}
</style>
