<!-- src/lib/editor/components/Editor.svelte -->
<script lang="ts">
    import { setContext, tick } from 'svelte';
    import type { EditorActions, BlockComponent, MutableDocument, UndoEntry } from '../editor-types';
    import { toMutable, cloneDocument, serializeMutable, assignIds } from '../mutable-tree';
    import {
        splitNode as performSplit,
        mergeWithPrevious as performMerge,
        deleteNode as performDelete,
        updateNodeContent as performUpdate
    } from '../tree-operations';
    import { createUndoManager } from '../undo-manager';
    import { parse } from '../core/parser';
    import BlockList from './BlockList.svelte';

    let { source = '' }: { source?: string } = $props();

    // ── State ───────────────────────────────────────────────────────────

    let doc = $state<MutableDocument>(toMutable(parse(source)));
    let blockIds = $state<string[]>(assignIds(doc.children));
    let blockRefs = $state<(BlockComponent | undefined)[]>([]);
    const undoManager = createUndoManager();

    // ── Undo snapshot helpers ───────────────────────────────────────────

    let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastUndoBlockIndex = -1;

    function pushUndoSnapshot(blockIndex: number, offset: number): void {
        undoManager.push({
            snapshot: cloneDocument(doc),
            focusBlockIndex: blockIndex,
            focusOffset: offset
        });
    }

    function pushUndoSnapshotDebounced(blockIndex: number, offset: number): void {
        if (lastUndoBlockIndex !== blockIndex) {
            // Focus moved to a different block — push immediately
            flushUndoDebounce(blockIndex, offset);
            lastUndoBlockIndex = blockIndex;
            return;
        }

        if (undoDebounceTimer) clearTimeout(undoDebounceTimer);
        undoDebounceTimer = setTimeout(() => {
            pushUndoSnapshot(blockIndex, offset);
            undoDebounceTimer = null;
        }, 500);
    }

    function flushUndoDebounce(blockIndex: number, offset: number): void {
        if (undoDebounceTimer) {
            clearTimeout(undoDebounceTimer);
            undoDebounceTimer = null;
        }
        pushUndoSnapshot(blockIndex, offset);
    }

    // ── EditorActions ───────────────────────────────────────────────────

    const actions: EditorActions = {
        async splitBlock(blockIndex: number, offset: number): Promise<void> {
            flushUndoDebounce(blockIndex, offset);
            performSplit(doc, blockIds, blockIndex, offset);
            // Trigger Svelte reactivity
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            blockRefs[blockIndex + 1]?.focus?.(0);
        },

        async mergeWithPrevious(blockIndex: number): Promise<void> {
            if (blockIndex <= 0) return;
            const prevRaw = doc.children[blockIndex - 1].raw;
            // Cursor should go at the end of the previous block's text (before \n)
            let mergeOffset = prevRaw.length;
            if (prevRaw.endsWith('\r\n')) mergeOffset -= 2;
            else if (prevRaw.endsWith('\n')) mergeOffset -= 1;

            flushUndoDebounce(blockIndex, 0);
            performMerge(doc, blockIds, blockIndex);
            doc.children = [...doc.children];
            blockIds = [...blockIds];
            await tick();
            blockRefs[blockIndex - 1]?.focus?.(mergeOffset);
        },

        async deleteBlock(blockIndex: number): Promise<void> {
            flushUndoDebounce(blockIndex, 0);
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

        updateBlockContent(blockIndex: number, text: string): void {
            pushUndoSnapshotDebounced(blockIndex, 0);
            const result = performUpdate(doc, blockIndex, text);
            if (result.kindChanged) {
                // Trigger full re-render for this block
                doc.children = [...doc.children];
            }
        },

        async requestUndo(): Promise<void> {
            const entry = undoManager.undo();
            if (!entry) return;
            // Push current state to redo first
            doc = entry.snapshot;
            blockIds = assignIds(doc.children);
            await tick();
            blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
        },

        async requestRedo(): Promise<void> {
            const entry = undoManager.redo();
            if (!entry) return;
            doc = entry.snapshot;
            blockIds = assignIds(doc.children);
            await tick();
            blockRefs[entry.focusBlockIndex]?.focus?.(entry.focusOffset);
        }
    };

    setContext('editor-actions', actions);

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
        max-width: 720px;
        margin: 0 auto;
        padding: 1rem;
        font-family: var(--font-editor, system-ui, sans-serif);
        font-size: 1rem;
        line-height: 1.6;
        color: var(--color-text-primary);
    }
</style>
