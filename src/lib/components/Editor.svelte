<script lang="ts">
	import { setContext } from 'svelte';
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
		type BlockElLookup,
		type DocumentGetter,
		type BlockComponent,
		type CstNode,
		type Document
	} from '../contracts';
	import { createStickyColumnState } from '../contenteditable/sticky-column';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../tree-operations/block-id';
	import { ensureEditableContainers } from '../tree-operations';
	import { serialize } from '../core/serializer';
	import { parse } from '../core/parser';
	import { parseAllInlineContent } from '../core/inline';
	import { createUndoManager } from '../undo-manager';
	import { createEditorActions } from './editor-actions';
	import BlockList from './BlockList.svelte';

	bootstrapCodeLanguages();

	let { source = '' }: { source?: string } = $props();

	// ── State ───────────────────────────────────────────────────────────

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

	// ── Action Bundles ──────────────────────────────────────────────────

	const { blockEdit, focus, history, containerEdit } = createEditorActions({
		get doc() {
			return doc;
		},
		get blockIds() {
			return blockIds;
		},
		get blockRefs() {
			return blockRefs;
		},
		setDoc: (v) => {
			doc = v;
		},
		setDocChildren: (v) => {
			doc.children = v;
		},
		setBlockIds: (v) => {
			blockIds = v;
		},
		setBlockRefs: (v) => {
			blockRefs = v;
		},
		undoManager,
		stickyColumn,
		selectionState,
		getBlockElByPath
	});

	// Reactive getter: block components call this at keystroke time to read
	// the latest doc, not the snapshot captured when they mounted.
	const getDoc: DocumentGetter = () => doc;

	setContext(BLOCK_EDIT_KEY, blockEdit);
	setContext(FOCUS_KEY, focus);
	setContext(HISTORY_KEY, history);
	setContext(CONTAINER_EDIT_KEY, containerEdit);
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
		return serialize(doc);
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
