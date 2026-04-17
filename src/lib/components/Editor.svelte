<script lang="ts">
	import { setContext, tick } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		CURSOR_END,
		type BlockEditActions,
		type BlockElLookup,
		type DocumentGetter,
		type FocusActions,
		type HistoryActions,
		type ContainerEditActions,
		type FocusPosition,
		type BlockComponent,
		type CstNode,
		type Document,
		type EditorSelection,
		type SelectionPoint,
		type UndoEntry
	} from '../editor-types';
	import { createStickyColumnState } from '../contenteditable/sticky-column';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { readCurrentSelection, applySelectionToDom } from '../selection/native-bridge';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { cloneDocument, serializeMutable, assignIds, generateBlockId } from '../mutable-tree';
	import { displayLength, trimTrailingLineEnding } from '../raw-text';
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

	bootstrapCodeLanguages();

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

	// Initialize from the `source` prop. doc/blockIds are mutable state
	// that structural operations write through directly, so they cannot be
	// $derived — we take a one-time snapshot at mount and re-sync via
	// $effect below when the prop changes.
	// svelte-ignore state_referenced_locally
	let doc = $state<Document>(initDocument(source));
	// svelte-ignore state_referenced_locally
	let blockIds = $state<string[]>(assignIds(doc.children));
	let blockRefs = $state<(BlockComponent | undefined)[]>([]);
	let editorEl: HTMLDivElement | undefined = $state();
	const undoManager = createUndoManager();
	const stickyColumn = createStickyColumnState();
	const selectionState = createSelectionState();

	// Re-initialize when source prop changes (e.g., async document load).
	// The `source !== lastSource` check is load-bearing: after the first
	// re-init reads `doc.children` (via assignIds), doc.children becomes
	// a tracked dependency of this effect, so subsequent user edits would
	// retrigger the effect and wipe their work without this guard.
	// svelte-ignore state_referenced_locally
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

	/** Build a collapsed EditorSelection from a top-level block index and offset. */
	function collapsedSelectionAt(blockIndex: number, offset: number): EditorSelection {
		const point: SelectionPoint = { path: [blockIndex], offset };
		return { anchor: point, focus: point };
	}

	function pushUndoSnapshot(blockIndex: number, offset: number): void {
		const selection = selectionState.isCrossBlock
			? readCurrentSelection(selectionState, blockRefs, collapsedSelectionAt)
			: collapsedSelectionAt(blockIndex, offset);
		undoManager.push({
			snapshot: cloneDocument(doc),
			blockIds: [...blockIds],
			selection
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

	/**
	 * Wrap a structural mutation with the full ceremony: clear pending undo
	 * debounce timer, push a snapshot, reset the checkpoint flag, apply the
	 * mutation on plain array copies, publish in one atomic write, tick,
	 * and invoke the optional post-tick callback (typically a focus call).
	 *
	 * Every structural action method begins with this sequence; extracting
	 * it here removes ~8 lines of duplication from each action.
	 */
	async function commitStructural(
		snapshotBlockIndex: number,
		snapshotOffset: number,
		mutate: (
			children: CstNode[],
			ids: string[],
			refs: (BlockComponent | undefined)[]
		) => void,
		afterTick?: () => void
	): Promise<void> {
		stickyColumn.reset();
		if (undoDebounceTimer) {
			clearTimeout(undoDebounceTimer);
			undoDebounceTimer = null;
		}
		pushUndoSnapshot(snapshotBlockIndex, snapshotOffset);
		needsUndoCheckpoint = true;

		const childrenCopy = [...doc.children];
		const idsCopy = [...blockIds];
		const refsCopy = [...blockRefs];
		mutate(childrenCopy, idsCopy, refsCopy);
		doc.children = childrenCopy;
		blockIds = idsCopy;
		blockRefs = refsCopy;

		await tick();
		afterTick?.();
	}

	function captureCurrentState(): UndoEntry {
		return {
			snapshot: cloneDocument(doc),
			blockIds: [...blockIds],
			selection: readCurrentSelection(selectionState, blockRefs, collapsedSelectionAt)
		};
	}

	// ── Action Bundles ──────────────────────────────────────────────────

	const blockEditActions: BlockEditActions = {
		async splitBlock(blockIndex: number, offset: number): Promise<void> {
			await commitStructural(
				blockIndex,
				offset,
				(children, ids, refs) => {
					// Work on plain array copies to prevent $state proxy splice mutations
					// from triggering intermediate reactive updates that corrupt the keyed
					// {#each} component-to-index mapping.
					performSplit({ children }, ids, blockIndex, offset);
					// Sync blockRefs: insert undefined slot for the new block.
					// bind:ref in keyed {#each} only fires on mount, not when components
					// shift positions, so we must manually keep refs aligned.
					refs.splice(blockIndex + 1, 0, undefined);
				},
				() => blockRefs[blockIndex + 1]?.focus(0)
			);
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
					await commitStructural(
						blockIndex,
						0,
						(children, ids, refs) => {
							performDelete({ children }, ids, blockIndex - 1);
							refs.splice(blockIndex - 1, 1);
						},
						() => blockRefs[blockIndex - 1]?.focus(0)
					);
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

			// Pre-compute join values before mutating (snapshot in commitStructural
			// must capture the pre-mutation state, so all mutation goes inside mutate).
			const target = mergeTarget.target;
			const targetRaw = target.raw ?? '';
			const currRaw = curr.raw ?? '';
			// Preserve the target's existing line ending style.
			const lineEnding = targetRaw.endsWith('\r\n') ? '\r\n' : '\n';
			const targetText = trimTrailingLineEnding(targetRaw);
			const currText = trimTrailingLineEnding(currRaw);
			const joinOffset = targetText.length;
			const mergedRaw = targetText + currText + lineEnding;

			// Delete curr from top-level children / ids / refs.
			// All mutations (target.raw, inline reparse, ancestry rebuild, array splice)
			// happen inside mutate so commitStructural snapshots the pre-mutation state.
			await commitStructural(
				blockIndex,
				0,
				(children, ids, refs) => {
					// Mutate the target's raw. target is a reference into the same object
					// tree that childrenCopy shares (shallow copy), so this is safe.
					target.raw = mergedRaw;

					// Refresh the target's inline content cache. The per-input reactive
					// pipeline doesn't fire here because the user was typing in curr, not
					// in target — we must re-parse explicitly.
					if (isProseKind(target.kind)) {
						const range = getContentRange(target);
						target.inlineContent = parseInline(target.raw, range.start, range.end);
					}

					// Rebuild ancestry raw for container-target merges. For top-level prose
					// merges (empty path) there's no ancestry to rebuild — the target IS prev.
					if (mergeTarget.path.length > 0) {
						rebuildAncestryRaw(prev, mergeTarget.path);
					}

					performDelete({ children }, ids, blockIndex);
					refs.splice(blockIndex, 1);
				},
				() => {
					// Focus cascade: for flat (prev === target) merges, focus prev directly.
					// For nested-target merges, use focusByPath to cascade down.
					if (mergeTarget.path.length === 0) {
						blockRefs[blockIndex - 1]?.focus(joinOffset);
					} else {
						blockRefs[blockIndex - 1]?.focusByPath?.(mergeTarget.path, joinOffset);
					}
				}
			);
		},

		async mergeWithNext(blockIndex: number): Promise<void> {
			stickyColumn.reset();
			if (blockIndex >= doc.children.length - 1) return;

			const currKind = doc.children[blockIndex].kind;
			const nextKind = doc.children[blockIndex + 1].kind;

			if (!isMergeEligible(currKind, nextKind)) {
				if (!isBlockEditable(nextKind)) {
					// Next block is non-editable — delete it
					await commitStructural(
						blockIndex,
						CURSOR_END,
						(children, ids, refs) => {
							performDelete({ children }, ids, blockIndex + 1);
							refs.splice(blockIndex + 1, 1);
						},
						() => blockRefs[blockIndex]?.focus(CURSOR_END)
					);
				} else {
					// Next block is editable but not mergeable — move focus
					blockRefs[blockIndex + 1]?.focus(0);
				}
				return;
			}

			// Mergeable — proceed with merge
			const mergeOffset = displayLength(doc.children[blockIndex].raw);

			await commitStructural(
				blockIndex,
				CURSOR_END,
				(children, ids, refs) => {
					performMergeNext({ children }, ids, blockIndex);
					refs.splice(blockIndex + 1, 1); // Remove next block's ref
				},
				() => blockRefs[blockIndex]?.focus(mergeOffset)
			);
		},

		async deleteBlock(blockIndex: number): Promise<void> {
			await commitStructural(
				blockIndex,
				0,
				(children, ids, refs) => {
					performDelete({ children }, ids, blockIndex);
					refs.splice(blockIndex, 1);
				},
				() => {
					// Focus the block that took the deleted block's position, or the previous one
					const focusIndex = Math.min(blockIndex, doc.children.length - 1);
					if (focusIndex >= 0) {
						blockRefs[focusIndex]?.focus(0);
					}
				}
			);
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

		async insertParsedBlocks(blockIndex: number, offset: number, blocks: CstNode[]): Promise<void> {
			if (blocks.length === 0) return;

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

			const lastIndex = blockIndex + newNodes.length - 1;

			// Work on plain copies to prevent proxy splice cascades
			await commitStructural(
				blockIndex,
				offset,
				(children, ids, refs) => {
					// Replace the original block with new nodes
					children.splice(blockIndex, 1, ...newNodes);

					// Update blockIds: keep original ID for first, generate new for the rest
					const newIds = newNodes.slice(1).map(() => generateBlockId());
					ids.splice(blockIndex + 1, 0, ...newIds);

					// Sync refs: replace one slot with N undefined slots
					const newRefSlots: (BlockComponent | undefined)[] = new Array(newNodes.length).fill(
						undefined
					);
					newRefSlots[0] = refs[blockIndex]; // keep existing ref for first node
					refs.splice(blockIndex, 1, ...newRefSlots);
				},
				() => {
					// Focus at end of last inserted node
					blockRefs[lastIndex]?.focus(CURSOR_END);
				}
			);
		},

		async replaceBlock(
			blockIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			if (blockIndex < 0 || blockIndex >= doc.children.length) return;

			// Preserve leading trivia of the original block on the first replacement.
			const originalTrivia = doc.children[blockIndex].leadingTrivia;

			// Normalize replacement nodes before entering commitStructural so the
			// mutation callback only handles the array splice.
			const normalizedReplacement =
				replacement.length > 0
					? replacement.map((node, i) => {
							const copy = { ...node };
							copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
							ensureEditableContainers(copy);
							return copy;
						})
					: [];

			// Parse inline content for any prose-kind replacement blocks.
			if (normalizedReplacement.length > 0) {
				parseAllInlineContent(normalizedReplacement);
			}

			// Work on plain copies to prevent $state proxy splice cascades.
			await commitStructural(
				blockIndex,
				focus?.offset ?? 0,
				(children, ids, refs) => {
					if (normalizedReplacement.length === 0) {
						// Degenerate case: delete the block.
						children.splice(blockIndex, 1);
						ids.splice(blockIndex, 1);
						refs.splice(blockIndex, 1);
					} else {
						children.splice(blockIndex, 1, ...normalizedReplacement);

						// IDs: fresh for each replacement block.
						const newIds = normalizedReplacement.map(() => generateBlockId());
						ids.splice(blockIndex, 1, ...newIds);

						// Refs: new undefined slots for each replacement block.
						const newRefSlots: (BlockComponent | undefined)[] = new Array(
							normalizedReplacement.length
						).fill(undefined);
						refs.splice(blockIndex, 1, ...newRefSlots);
					}
				},
				() => {
					if (focus && normalizedReplacement.length > 0) {
						const targetIndex = blockIndex + focus.replacementIndex;
						blockRefs[targetIndex]?.focus(focus.offset);
					}
				}
			);
		}
	};

	const focusActions: FocusActions = {
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
		}
	};

	const historyActions: HistoryActions = {
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
			applySelectionToDom(entry.selection, selectionState, getBlockElByPath);
		},

		async requestRedo(): Promise<void> {
			stickyColumn.reset();
			const entry = undoManager.redo(captureCurrentState());
			if (!entry) return;
			doc = entry.snapshot;
			parseAllInlineContent(doc.children);
			blockIds = entry.blockIds;
			await tick();
			applySelectionToDom(entry.selection, selectionState, getBlockElByPath);
		}
	};

	const containerEditActions: ContainerEditActions = {
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

	// Block path → DOM lookup. Walks from the editor root to the .block-host
	// wrapper carrying the matching data-block-path, then returns the wrapper's
	// first non-overlay child (the block component's outermost element, used
	// as the measurement surface for cross-block caret math). Container blocks
	// have their own nested BlockList, so the element returned for a container
	// path is the container's root, not any child leaf.
	const getBlockElByPath: BlockElLookup = (path) => {
		if (!editorEl) return null;
		const attr = JSON.stringify(path);
		const wrapper = editorEl.querySelector(`[data-block-path='${attr}']`);
		if (!wrapper) return null;
		return wrapper.querySelector(':scope > :not(.selection-overlay)') as HTMLElement | null;
	};

	// Reactive getter: block components call this at keystroke time to read
	// the latest doc, not the snapshot captured when they mounted.
	const getDoc: DocumentGetter = () => doc;

	setContext(BLOCK_EDIT_KEY, blockEditActions);
	setContext(FOCUS_KEY, focusActions);
	setContext(HISTORY_KEY, historyActions);
	setContext(CONTAINER_EDIT_KEY, containerEditActions);
	setContext(STICKY_COLUMN_KEY, stickyColumn);
	setContext(SELECTION_KEY, selectionState);
	setContext(BLOCK_EL_LOOKUP_KEY, getBlockElByPath);
	setContext(DOC_KEY, getDoc);
	setContext(EDITOR_ROOT_KEY, () => editorEl ?? null);

	// Mirror SelectionState.isCrossBlock onto the editor root as
	// `data-cross-block`. CSS uses this to hide the native caret / native
	// selection highlight while the overlay paints the cross-block range.
	$effect(() => {
		if (!editorEl) return;
		if (selectionState.isCrossBlock) {
			editorEl.setAttribute('data-cross-block', '');
		} else {
			editorEl.removeAttribute('data-cross-block');
		}
	});

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serializeMutable(doc);
	}

	export function getSelectionState() {
		return selectionState;
	}
</script>

<div class="editor" bind:this={editorEl}>
	<BlockList children={doc.children} {blockIds} bind:blockRefs parentPath={[]} />
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
