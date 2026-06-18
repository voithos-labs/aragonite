<script lang="ts">
	import { setContext } from 'svelte';
	import '../styles/editor.css';
	import type { BlockComponent } from '../block-component';
	import type { Document } from '../core/nodes';
	import {
		BLOCK_COMPONENT_LOOKUP_KEY,
		BLOCK_EDIT_KEY,
		BLOCK_EL_LOOKUP_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		DOC_KEY,
		EDITOR_EVENTS_KEY,
		EDITOR_LIFETIME_KEY,
		EDITOR_ROOT_KEY,
		FOCUSED_PATH_KEY,
		FOCUS_KEY,
		HEIGHT_ORACLE_KEY,
		HISTORY_KEY,
		IMAGE_LOAD_POLICY_KEY,
		LINK_REF_KEY,
		PASTE_COORDINATOR_KEY,
		RESOLVE_IMAGE_URL_KEY,
		RESOLVE_LINK_URL_KEY,
		SELECTION_KEY,
		STICKY_COLUMN_KEY,
		WIDGET_SELECTION_KEY,
		WIDTH_VERSION_KEY,
		type BlockComponentLookup,
		type BlockElLookup,
		type DocumentGetter,
		type EditorSelection,
		type ResolveImageUrl,
		type ResolveLinkUrl
	} from '../editor-keys';
	import { dispatchGetBlockComponentByPath } from '../editor-actions/focus-dispatch';
	import { createStickyColumnState } from '../cursor/sticky-column';
	import { createHeightOracle } from '../cursor/height-oracle';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { whenRefMounted } from '../reactivity/publish-ref.svelte';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { createSelectionDescription } from '../selection/selection-description';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../block-id';
	import { ensureEditableContainers } from '../tree-operations';
	import { serialize } from '../core/serializer';
	import { parse } from '../core/parser';
	import { countProseNodes, parseAllInlineContent } from '../core/inline';
	import { collectInlineDirty } from '../inline-dirty-set';
	import { perfEnabled, recordInlineRefresh } from '../perf/instruments';
	import {
		buildLinkReferenceMap,
		type LinkReferenceResolver
	} from '../core/inline/link-reference-resolver';
	import { createUndoManager } from '../undo/manager';
	import { createSharingState } from '../undo/epoch-tracker';
	import { createEditorEvents } from '../editor-events';
	import { createEditorActions } from '../editor-actions';
	import { createPasteCoordinator } from '../editor-actions/paste-coordinator';
	import { createOperationsLog } from '../debug/operations-log';
	import { readCurrentSelection } from '../selection/native-bridge';
	import BlockList from './BlockList.svelte';
	import ImageOverlayHost from './image/ImageOverlayHost.svelte';
	import { runStartupInvariantChecks } from '../invariants/install';
	import './built-in-blocks';

	bootstrapCodeLanguages();
	runStartupInvariantChecks();

	let {
		source = '',
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy = 'auto',
		onLinkActivate
	}: {
		source?: string;
		resolveImageUrl?: (rawUrl: string) => string;
		resolveLinkUrl?: (rawUrl: string) => string;
		imageLoadPolicy?: import('../core/inline-render').ImageLoadPolicy;
		onLinkActivate?: (url: string, event: MouseEvent) => void;
	} = $props();

	const resolveImageUrlImpl: ResolveImageUrl = (u) => (resolveImageUrl ? resolveImageUrl(u) : u);
	const resolveLinkUrlImpl: ResolveLinkUrl = (u) => (resolveLinkUrl ? resolveLinkUrl(u) : u);
	const activateLink = (url: string, event: MouseEvent) =>
		onLinkActivate ? onLinkActivate(url, event) : window.open(url, '_blank', 'noopener,noreferrer');

	// ── State ───────────────────────────────────────────────────────────

	function initDocument(src: string): {
		doc: Document;
		resolver: LinkReferenceResolver;
		signature: string;
	} {
		const d = parse(src);
		if (d.children.length === 0) {
			d.children.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
		}
		for (const child of d.children) {
			ensureEditableContainers(child);
		}
		const refMap = buildLinkReferenceMap(d.children);
		parseAllInlineContent(d.children, refMap.resolve);
		return { doc: d, resolver: refMap.resolve, signature: refMap.signature };
	}

	// Initialize from the `source` prop. doc/blockIds are mutable state
	// that structural operations write through directly, so they cannot be
	// $derived — we take a one-time snapshot at mount and re-sync via
	// $effect below when the prop changes.
	const initial = initDocument(source);
	// svelte-ignore state_referenced_locally
	let doc = $state<Document>(initial.doc);
	// svelte-ignore state_referenced_locally
	let blockIds = $state<string[]>(assignIds(doc.children));
	let currentResolver = $state<LinkReferenceResolver>(initial.resolver);
	let currentSignature = $state<string>(initial.signature);
	// Plain array — $state's mutation guards revert writes from a BlockHost
	// publish that fires during the post-undo reactive flush.
	let blockRefs: (BlockComponent | undefined)[] = [];
	let editorEl: HTMLDivElement | undefined = $state();
	const undoManager = createUndoManager();
	const sharing = createSharingState();
	const stickyColumn = createStickyColumnState();
	const operationsLog = createOperationsLog();
	const events = createEditorEvents();
	// getSelection is function-hoisted below — callback reads the fresh snapshot each time.
	const selectionState = createSelectionState({
		onChange: () => events.emit('selectionChange', getSelection()),
		getDoc: () => doc
	});
	const widgetSelection = createWidgetSelectionState({
		onSelect: () => {
			window.getSelection()?.removeAllRanges();
			selectionState.clear();
		}
	});

	let selectionDescription = $derived(
		selectionState.isCrossBlock && selectionState.anchor && selectionState.focus
			? createSelectionDescription({ anchor: selectionState.anchor, focus: selectionState.focus })
			: ''
	);

	$effect(() => {
		const dispose = events.on('edit', (e) => {
			operationsLog?.record({
				op: e.op,
				path: e.path,
				detail: ('detail' in e ? e.detail : undefined) ?? {}
			});
			// Sole populator of `inlineContent`: every emitted `edit` event
			// (structural commits, the debounced input flush, undo/redo) refreshes
			// the cache with a fresh resolver here. Operations must NOT pre-populate
			// — any tree they build is overwritten before a consumer can read it.
			// The LRD map rebuild stays whole-doc (cheap raw-free walk; incremental
			// maintenance is roadmapped); the sweep is scoped by collectInlineDirty.
			const newMap = buildLinkReferenceMap(doc.children);
			const signatureChanged = newMap.signature !== currentSignature;
			const dirty = collectInlineDirty(doc, e, signatureChanged);
			const targets = dirty === 'all' ? doc.children : dirty;
			parseAllInlineContent(targets, newMap.resolve);
			// Reassign only on a real LRD change. Routine typing leaves the
			// resolver set identical, so handing out a fresh closure identity here
			// would invalidate every block that read the resolver at mount — a
			// one-time whole-document re-render on the first edit.
			if (signatureChanged) {
				currentResolver = newMap.resolve;
				currentSignature = newMap.signature;
			}
			if (perfEnabled()) recordInlineRefresh(countProseNodes(targets));
		});
		return () => dispose();
	});

	// `source !== lastSource` guard is load-bearing — see `docs/design/editor/editor.md` § Reactive State Plumbing.
	// svelte-ignore state_referenced_locally
	let lastSource = source;
	$effect(() => {
		if (source !== lastSource) {
			lastSource = source;
			const reset = initDocument(source);
			doc = reset.doc;
			blockIds = assignIds(doc.children);
			blockRefs = [];
			undoManager.clear();
			stickyColumn.reset();
			selectionState.clear();
			currentResolver = reset.resolver;
			currentSignature = reset.signature;
		}
	});

	$effect(() => {
		if (!editorEl) return;
		const handleClick = (e: MouseEvent) => {
			const target = e.target as Element | null;
			const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
			if (!anchor) return;
			const href = anchor.getAttribute('href');
			if (!href) return;
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				activateLink(href, e);
			} else {
				// Plain click inside contenteditable — prevent the browser's default
				// link navigation. Cursor placement comes from mousedown, unaffected.
				e.preventDefault();
			}
		};
		editorEl.addEventListener('click', handleClick);
		return () => editorEl?.removeEventListener('click', handleClick);
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
			return directWrapper.querySelector(':scope > :not(.selection-overlay)') as HTMLElement | null;
		}
		if (path.length < 3) return null;
		const tablePath = path.slice(0, -2);
		const rowIdx = path[path.length - 2];
		const colIdx = path[path.length - 1];
		const tableWrapper = editorEl.querySelector(`[data-block-path='${JSON.stringify(tablePath)}']`);
		if (!tableWrapper) return null;
		const tableEl = tableWrapper.querySelector(':scope > [role="table"]');
		if (!tableEl) return null;
		const rowEl = tableEl.querySelector(`:scope > [data-table-row-idx='${rowIdx}']`);
		if (!rowEl) return null;
		const cells = rowEl.querySelectorAll(':scope > [role="cell"]');
		return (cells[colIdx] as HTMLElement | undefined) ?? null;
	};

	const getBlockComponentByPath: BlockComponentLookup = (path) =>
		dispatchGetBlockComponentByPath(blockRefs, path);

	// ── Action Bundles ──────────────────────────────────────────────────

	// Hoisted so the deps literal below can reference it before the VR state it
	// reads (editorEl/topWindowing) is declared; the body runs only at call time,
	// post-init.
	async function revealPath(path: number[]): Promise<BlockComponent | null> {
		if (path.length === 0) return null;
		const top = path[0];
		// Only scroll-and-await for an in-doc, unmounted block: an out-of-doc index
		// (transient size lag) can never mount, so the loop would hang — fall through
		// and return what's there. An already-mounted block needs no scroll.
		if (top < doc.children.length && !blockRefs[top]) {
			await topWindowing.revealChild(top);
			// A nested block mounting at the same local index can wake the wait while
			// blockRefs[top] is still empty; re-wait until the real top-level mount lands.
			while (!blockRefs[top]) await whenRefMounted(top, () => !!blockRefs[top]);
		}
		const ref = blockRefs[top];
		if (!ref) return null;
		if (path.length === 1) return ref;
		return ref.revealByPath
			? await ref.revealByPath(path.slice(1))
			: (ref.getBlockComponentByPath?.(path.slice(1)) ?? null);
	}

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
		// In-place mutation — closures capture this array, reassignment would orphan their writes.
		setBlockRefs: (v) => {
			blockRefs.length = v.length;
			for (let i = 0; i < v.length; i++) blockRefs[i] = v[i];
		},
		undoManager,
		sharing,
		stickyColumn,
		selectionState,
		getBlockElByPath,
		revealPath,
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
	setContext(WIDGET_SELECTION_KEY, widgetSelection);
	setContext(RESOLVE_IMAGE_URL_KEY, resolveImageUrlImpl);
	setContext(RESOLVE_LINK_URL_KEY, resolveLinkUrlImpl);
	setContext(IMAGE_LOAD_POLICY_KEY, () => imageLoadPolicy);
	setContext(EDITOR_EVENTS_KEY, events);
	setContext(BLOCK_EL_LOOKUP_KEY, getBlockElByPath);
	setContext(BLOCK_COMPONENT_LOOKUP_KEY, getBlockComponentByPath);
	setContext(DOC_KEY, getDoc);
	setContext(EDITOR_ROOT_KEY, () => editorEl ?? null);
	setContext(EDITOR_LIFETIME_KEY, lifetimeController.signal);
	setContext(LINK_REF_KEY, {
		get current(): LinkReferenceResolver {
			return currentResolver;
		},
		get signature(): string {
			return currentSignature;
		}
	});

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

	// ── Virtual rendering (top-level windowing) ──────────────────────────

	const heightOracle = createHeightOracle({
		lineHeight: 24,
		codeLineHeight: 20,
		avgCharWidth: 8,
		blockChrome: 16,
		imageBlockMinHeight: 200
	});
	setContext(HEIGHT_ORACLE_KEY, heightOracle);

	// A WIDTH change re-wraps prose, so every height the oracle cached at the old width
	// is stale and every windowing scope must rebuild + re-measure. The editor root owns
	// one ResizeObserver on its scroll element; on a real width delta it clears the
	// oracle's measured cache and bumps this counter, which the scopes read to rebuild
	// (and which anchor-corrects the reflow so the viewport stays put). A height-only
	// resize doesn't re-wrap, so it's ignored. ResizeObserver's per-callback batching is
	// the coalescing — no setTimeout/rAF debounce (G4.4).
	let widthVersion = $state(0);
	setContext(WIDTH_VERSION_KEY, () => widthVersion);
	$effect(() => {
		const el = editorEl;
		if (!el) return;
		let lastWidth = el.clientWidth;
		const observer = new ResizeObserver(() => {
			const width = el.clientWidth;
			if (width === lastWidth) return;
			lastWidth = width;
			heightOracle.invalidateWidth();
			widthVersion++;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	// The focused block's full path drives each windowing scope's per-level pin, so
	// a scroll that pushes the caret off-screen never tears down native focus/IME.
	//
	// Plain `let`, not $state: focusout fires synchronously while Svelte tears
	// down a focused block's DOM during a structural commit, so writing it from
	// the handler would trip state_unsafe_mutation. The window derived still
	// re-slices on scroll and after every commit, and a focus change can't drop a
	// mounted block, so the pin needn't be reactive.
	let focusedPath: number[] | null = null;
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const onFocusIn = (e: FocusEvent) => {
			const host = (e.target as Element | null)?.closest('[data-block-path]');
			if (!host || !root.contains(host)) {
				focusedPath = null;
				return;
			}
			try {
				const path = JSON.parse(host.getAttribute('data-block-path')!) as number[];
				focusedPath = Array.isArray(path) && path.length > 0 ? path : null;
			} catch {
				focusedPath = null;
			}
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks — keep the pin
			focusedPath = null;
		};
		root.addEventListener('focusin', onFocusIn);
		root.addEventListener('focusout', onFocusOut);
		return () => {
			root.removeEventListener('focusin', onFocusIn);
			root.removeEventListener('focusout', onFocusOut);
		};
	});
	setContext(FOCUSED_PATH_KEY, () => focusedPath);

	// The root sources HEIGHT_ORACLE/FOCUSED_PATH/EDITOR_ROOT above; the hook reads
	// them back via getContext. getListEl is the inner .block-list wrapper, not
	// editorEl (== scrollEl): it scrolls with content, so its top maps root
	// scrollTop into local coordinates — feeding editorEl collapses it to 0.
	const topWindowing = useContainerWindowing({
		getIndex: () => 0, // ignored — root has no parent sink (reportSelfHeight is undefined)
		getParentPath: () => [],
		getChildren: () => doc.children,
		getChildIds: () => blockIds,
		getListEl: () => editorEl?.querySelector(':scope > .block-list') ?? null,
		provideLeafChannel: true
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
		return readCurrentSelection(selectionState, blockRefs);
	}

	export function getEvents() {
		return events;
	}

	function setBlockRefSlot(i: number, r: BlockComponent | undefined): void {
		blockRefs[i] = r;
	}
	function getBlockRefSlot(i: number): BlockComponent | undefined {
		return blockRefs[i];
	}

	// ── Test-only surface ───────────────────────────────────────────────

	function getOperationsLog() {
		return operationsLog;
	}

	function getUndoStack() {
		return undoManager.getStacks();
	}

	/**
	 * Return the live CST Document. Callers must treat the returned object as
	 * read-only — mutating it bypasses the undo pipeline.
	 */
	function getDocument() {
		return doc;
	}

	function getBlockComponent(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [first, ...rest] = path;
		const ref = blockRefs[first];
		if (!ref) return null;
		if (rest.length === 0) return ref;
		return ref.getBlockComponentByPath?.(rest) ?? null;
	}

	export const __test = { getDocument, getBlockComponent, getUndoStack, getOperationsLog };
</script>

<div class="editor" bind:this={editorEl} role="group" aria-label="Markdown editor">
	<BlockList
		children={doc.children}
		{blockIds}
		setRef={setBlockRefSlot}
		getRef={getBlockRefSlot}
		parentPath={[]}
		window={topWindowing.window}
	/>
	<ImageOverlayHost
		{widgetSelection}
		{controller}
		{events}
		{getDoc}
		getEditorEl={() => editorEl ?? null}
		getSelectionIsCustomRendered={() => selectionState.isCustomRendered}
		lifetime={lifetimeController.signal}
	/>
	<div class="editor-sr-live" role="status" aria-live="polite">{selectionDescription}</div>
</div>

<style>
	.editor {
		width: 100%;
		flex: 1;
		padding: 1rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 1rem;
		line-height: 1.6;
		color: var(--color-text-primary, #ffffff);
		min-height: 200px;
		overflow-y: auto;
		/* The editor owns scroll-anchor correction manually (list-windowing's
		   correctAnchor): record the top-of-viewport block's offset before a measure-in
		   or width reflow, shift scrollTop by the delta after. Native scroll anchoring
		   FIGHTS that — it independently rewrites scrollTop (~2,264px on a deep jump into
		   an unmeasured band), double-correcting. Disable it so the manual path owns the
		   line; do NOT restore `overflow-anchor` (VR-2/VR-2a). */
		overflow-anchor: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #a4a4a4) transparent;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		/* Containing block for the image overlay portal. */
		position: relative;
	}

	.editor::-webkit-scrollbar {
		width: 6px;
	}

	.editor::-webkit-scrollbar-track {
		background: transparent;
	}

	.editor::-webkit-scrollbar-thumb {
		background: var(--color-ui-muted, #a4a4a4);
		border-radius: 3px;
	}

	.editor::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #afb1b3);
	}

	.editor-sr-live {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
