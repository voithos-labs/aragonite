<script lang="ts">
	import { setContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		PASTE_COORDINATOR_KEY,
		STICKY_COLUMN_KEY,
		SELECTION_KEY,
		BLOCK_EL_LOOKUP_KEY,
		DOC_KEY,
		EDITOR_ROOT_KEY,
		EDITOR_LIFETIME_KEY,
		type BlockElLookup,
		type DocumentGetter,
		type BlockComponent,
		type CstNode,
		type Document,
		type EditorSelection
	} from '../contracts';
	import { createStickyColumnState } from '../cursor/sticky-column';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../tree-operations/block-id';
	import { ensureEditableContainers } from '../tree-operations';
	import { serialize } from '../core/serializer';
	import { parse } from '../core/parser';
	import { parseAllInlineContent } from '../core/inline';
	import { createUndoManager } from '../undo-manager';
	import { createEditorEvents } from '../editor-events';
	import { createEditorActions } from '../editor-actions';
	import { createPasteCoordinator } from '../editor-actions/paste-coordinator';
	import { createOperationsLog } from '../debug/operations-log';
	import BlockList from './BlockList.svelte';

	bootstrapCodeLanguages();

	let { source = '' }: { source?: string } = $props();

	// ── State ───────────────────────────────────────────────────────────

	function initDocument(src: string): Document {
		const d = parse(src);
		if (d.children.length === 0) {
			d.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
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
	const operationsLog = createOperationsLog();
	const events = createEditorEvents();
	// getSelection is function-hoisted below — callback reads the fresh snapshot each time.
	const selectionState = createSelectionState({
		onChange: () => events.emit('selectionChange', getSelection()),
		getDoc: () => doc
	});

	$effect(() => {
		const dispose = events.on('edit', (e) => {
			operationsLog?.record({
				op: e.op,
				path: e.path,
				detail: ('detail' in e ? e.detail : undefined) ?? {}
			});
		});
		return () => dispose();
	});

	// `source !== lastSource` guard is load-bearing — see `docs/design/editor/editor.md` § Reactive State Plumbing.
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
			selectionState.clear();
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

	// Returns the block's outermost element (first non-overlay child of the wrapper)
	// — used as the measurement surface for cross-block caret math. Table cells
	// don't carry data-block-path (they're rendered without BlockHost), so a
	// deep cell path [...tablePath, rowIdx, colIdx] resolves the table wrapper
	// then walks into the cell DOM.
	const getBlockElByPath: BlockElLookup = (path) => {
		if (!editorEl) return null;
		const directWrapper = editorEl.querySelector(`[data-block-path='${JSON.stringify(path)}']`);
		if (directWrapper) {
			return directWrapper.querySelector(
				':scope > :not(.selection-overlay)'
			) as HTMLElement | null;
		}
		if (path.length < 3) return null;
		const tablePath = path.slice(0, -2);
		const rowIdx = path[path.length - 2];
		const colIdx = path[path.length - 1];
		const tableWrapper = editorEl.querySelector(
			`[data-block-path='${JSON.stringify(tablePath)}']`
		);
		if (!tableWrapper) return null;
		const tableEl = tableWrapper.querySelector(':scope > [role="table"]');
		if (!tableEl) return null;
		const rowEl = tableEl.querySelector(`[data-table-row-idx='${rowIdx}']`);
		if (!rowEl) return null;
		const cells = rowEl.querySelectorAll(':scope > [role="cell"]');
		return (cells[colIdx] as HTMLElement | undefined) ?? null;
	};

	// ── Action Bundles ──────────────────────────────────────────────────

	const { blockEdit, focus, history, containerEdit, controller } = createEditorActions({
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
		setBlockIds: (v) => {
			blockIds = v;
		},
		setBlockRefs: (v) => {
			blockRefs = v;
		},
		undoManager,
		stickyColumn,
		selectionState,
		getBlockElByPath,
		events
	});

	// Reactive getter: block components call this at keystroke time to read
	// the latest doc, not the snapshot captured when they mounted.
	const getDoc: DocumentGetter = () => doc;

	// Lifetime signal: aborted when this Editor unmounts. Document-level
	// listeners (drag-pointer) observe it to cancel mid-operation work.
	const lifetimeController = new AbortController();
	$effect(() => () => lifetimeController.abort());

	setContext(BLOCK_EDIT_KEY, blockEdit);
	setContext(FOCUS_KEY, focus);
	setContext(HISTORY_KEY, history);
	setContext(CONTAINER_EDIT_KEY, containerEdit);
	setContext(CONTROLLER_KEY, controller);
	setContext(PASTE_COORDINATOR_KEY, createPasteCoordinator(controller));
	setContext(STICKY_COLUMN_KEY, stickyColumn);
	setContext(SELECTION_KEY, selectionState);
	setContext(BLOCK_EL_LOOKUP_KEY, getBlockElByPath);
	setContext(DOC_KEY, getDoc);
	setContext(EDITOR_ROOT_KEY, () => editorEl ?? null);
	setContext(EDITOR_LIFETIME_KEY, lifetimeController.signal);

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

	// Bridge native caret movement (click, arrow key) onto the
	// `selectionChange` event. Single-block motion doesn't go through
	// SelectionState, so without this listener subscribers would miss every
	// intra-block caret move. Scoped to this editor's root to avoid noise
	// from DevTools selections or other parts of the page.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const handler = () => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return;
			const anchorNode = sel.anchorNode;
			if (!anchorNode || !root.contains(anchorNode)) return;
			events.emit('selectionChange', getSelection());
		};
		document.addEventListener('selectionchange', handler);
		return () => document.removeEventListener('selectionchange', handler);
	});

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serialize(doc);
	}

	/**
	 * Return a frozen snapshot of the current selection (anchor/focus path +
	 * offset), or null when nothing is focused. Cross-block ranges come from
	 * SelectionState; single-block carets are read from the native DOM via
	 * the focused block's ref. Path arrays are copies — mutating the result
	 * does not affect internal state.
	 */
	export function getSelection(): EditorSelection | null {
		if (selectionState.isCrossBlock && selectionState.anchor && selectionState.focus) {
			return {
				anchor: {
					path: selectionState.anchor.path.slice(),
					offset: selectionState.anchor.offset
				},
				focus: {
					path: selectionState.focus.path.slice(),
					offset: selectionState.focus.offset
				}
			};
		}
		for (let i = 0; i < blockRefs.length; i++) {
			const ref = blockRefs[i];
			if (!ref) continue;
			const offset = ref.getCursorOffset();
			if (offset === null) continue;
			return {
				anchor: { path: [i], offset },
				focus: { path: [i], offset }
			};
		}
		return null;
	}

	export function getEvents() {
		return events;
	}

	export function getOperationsLog() {
		return operationsLog;
	}

	export function getUndoStack() {
		return undoManager.getStacks();
	}

	/**
	 * Return the live CST Document. Intended for test harnesses that need to
	 * walk the actual mutated tree (not a re-parse of the serialized source).
	 * Callers must treat the returned object as read-only — mutating it
	 * bypasses the undo pipeline.
	 */
	export function getDocument() {
		return doc;
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
