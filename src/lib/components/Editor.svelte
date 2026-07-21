<script lang="ts">
	import { setContext, tick, onMount } from 'svelte';
	import '../styles/editor.css';
	import type { BlockComponent } from '../block-component';
	import type { Document } from '../core/nodes';
	import type { EditorProps, EditorInstance, EditorDiagnostics } from '../editor-props';
	import type { EditorEvents } from '../editor-events';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_POLICIES_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		HISTORY_KEY,
		type BlockElLookup,
		type DocumentGetter,
		type EditorDoc,
		type EditorPolicies,
		type EditorServices,
		type PluginEditorLookup,
		type ResolveImageUrl,
		type ResolveLinkUrl
	} from '../editor-keys';
	import { createStickyColumnState } from '../cursor/sticky-column';
	import { createRevealAnchorState } from '../cursor/reveal-anchor';
	import { createHeightOracle } from '../cursor/height-oracle';
	import { HEIGHT_ESTIMATES } from '../cursor/typography-estimates';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { revealChildOrWait } from '../reactivity/publish-ref.svelte';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { createSelectionDescription } from '../selection/selection-description';
	import type { EditorSelection } from '../selection/primitives';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../block-id';
	import { ensureEditableContainers } from '../tree-operations';
	import { serialize } from '../core/serializer';
	import { parse } from '../core/parser';
	import { defaultLinkActivation } from '../core/url-policy';
	import { lrdMapCouldChange } from './lrd-map-gate';
	import {
		buildLinkReferenceMap,
		type LinkReferenceResolver
	} from '../core/inline/link-reference-resolver';
	import { createUndoManager } from '../undo/manager';
	import { createSharingState } from '../tree-operations/sharing';
	import { createEditorEvents, emitCommandError } from '../editor-events';
	import { createEditorActions, type EditorActionsDeps } from '../editor-actions';
	import { createReorderAction } from '../editor-actions/reorder-action';
	import { createSearchReplace } from '../editor-actions/search-replace';
	import { createSearchState, type SearchState } from '../search/search-state.svelte';
	import { createDecorationEngine } from '../decorations/decoration-state.svelte';
	import type { DecorationRegistry } from '../decorations/types';
	import { createEditorRects, type EditorRects } from '../editor-rects';
	import { installReorderDrag } from '../editor-actions/reorder-drag';
	import { createPasteCoordinator } from '../editor-actions/paste-coordinator';
	import { createOperationsLog } from '../debug/operations-log';
	import { dumpInteractionTrace, dumpOperationsLog } from '../debug/inspect';
	import { buildDiagnosticsReport } from '../debug/diagnostics-report';
	import {
		enableInteractionTrace,
		disableInteractionTrace,
		isInteractionTraceEnabled,
		interactionTraceSnapshot
	} from '../debug/interaction-trace';
	import { readCurrentSelection } from '../selection/native-bridge';
	import { createCrossBlockHandlers } from '../selection/cross-block/dispatch';
	import { isPreviewMode } from '../presentation-mode';
	import { normalizeKeybindingOverrides } from '../schema/keybinding-overrides';
	import { eventToChord } from '../schema/keybindings';
	import {
		isEditorGlobalChord,
		isReservedUiChord,
		resolveGlobalBinding,
		getCommand
	} from '../schema/commands';
	import {
		registerEditor,
		unregisterEditor,
		markEditorInteracted,
		claimsBodyChord,
		isForeignTextEntry,
		releaseInteractedEditor
	} from '../active-editor';
	import type { CommandErrorSink } from '../schema/block-commands';
	import { installPlugins, normalizePluginEntries } from '../schema/plugin-install';
	import { createEditorPluginContexts, mintEditorId } from '../schema/plugin-editor-context';
	import { createRegistryView, type KindEnablement } from '../schema/registry-view';
	import BlockList from './BlockList.svelte';
	import SearchBar from './SearchBar.svelte';
	import ImageOverlayHost from './image/ImageOverlayHost.svelte';
	import { runStartupInvariantChecks } from '../invariants/install';
	import { registerBuiltInBlocks } from './built-in-blocks';
	import { BLOCK_CONTENT_SELECTOR } from './block-content-selector';

	registerBuiltInBlocks();
	bootstrapCodeLanguages();
	runStartupInvariantChecks();

	// `__registryEnablement` is a harness-only door: a per-instance
	// enablement predicate for the registry view, NOT part of the public EditorProps.
	// The intersection keeps it off the exported type.
	let {
		source = '',
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy = 'auto',
		onLinkActivate,
		blockDragHandles = true,
		searchBar = true,
		keybindings,
		theme = 'dark',
		presentationMode = 'source',
		plugins,
		__registryEnablement
	}: EditorProps & { __registryEnablement?: KindEnablement } = $props();

	// Install before initDocument parses `source`, so plugin openers/directives are
	// live for the seed grammar. Set-once by contract — a later prop change is ignored.
	// Options ride each entry, kept per-instance even though installation is global.
	// svelte-ignore state_referenced_locally
	const pluginEntries = plugins?.length ? normalizePluginEntries(plugins) : undefined;
	if (pluginEntries) installPlugins(pluginEntries.plugins);

	const overridesMap = $derived(normalizeKeybindingOverrides(keybindings));

	// The one mode every door reports (root attribute, context getter, plugin
	// contexts, events). Effective equals requested today; this derived is the seam
	// a future effective-vs-requested divergence would land in.
	const effectiveMode = $derived(presentationMode);
	// Replace is an edit, so it never engages in reading mode. One predicate feeds
	// the write sites (Ctrl+H, chevron), the render gate, and the replace closures.
	const canReplace = $derived(effectiveMode !== 'reading');

	const resolveImageUrlImpl: ResolveImageUrl = (u) => (resolveImageUrl ? resolveImageUrl(u) : u);
	const resolveLinkUrlImpl: ResolveLinkUrl = (u) => (resolveLinkUrl ? resolveLinkUrl(u) : u);
	const activateLink = (url: string, event: MouseEvent) =>
		(onLinkActivate ?? defaultLinkActivation)(url, event);

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
		return { doc: d, resolver: refMap.resolve, signature: refMap.signature };
	}

	// Initialize from the `source` prop. doc/blockIds are mutable state
	// that structural operations write through directly, so they cannot be
	// $derived — we take a one-time snapshot at mount and re-sync via
	// $effect below when the prop changes.
	// svelte-ignore state_referenced_locally
	const initial = initDocument(source);
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
	const revealAnchor = createRevealAnchorState();
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

	// Screen-reader announcement for keyboard/drag reorder, set by the reorder
	// action's commit callback. Its own polite region — clobbering
	// selectionDescription would drop the move from the a11y tree.
	let reorderAnnouncement = $state('');

	// Drag-reorder overlay: a single ghost (follows the pointer) + one insertion
	// line, driven by the drag controller. Single elements, not per-block, so the
	// hover/drag path adds no per-mounted-component cost.
	let reorderGhost = $state<{ clientX: number; clientY: number; label: string } | null>(null);
	let reorderLine = $state<{ left: number; top: number; width: number } | null>(null);

	$effect(() => {
		const dispose = events.on('edit', (e) => {
			operationsLog?.record({
				op: e.op,
				path: e.path,
				detail: ('detail' in e ? e.detail : undefined) ?? {}
			});
			// The shell maintains only the LRD resolver (inline content is computed
			// lazily on read — core/inline/inline-cache): rebuild the map when a commit
			// could change the LRD set, and hand out a fresh resolver identity only on a
			// real signature change — a fresh identity on every edit would re-render
			// every block that read it.
			if (lrdMapCouldChange(doc, e)) {
				const newMap = buildLinkReferenceMap(doc.children);
				if (newMap.signature !== currentSignature) {
					currentResolver = newMap.resolve;
					currentSignature = newMap.signature;
				}
			}
		});
		return () => dispose();
	});

	// Re-run decoration sources after a commit, deferred a tick past the edit event so
	// no source ever reads a half-applied tree (the DEV commit-scope assert guards it).
	// Skipped entirely when no source is registered — zero keystroke work by default
	// (perf contract, checked by perf:check). Search rides this too: its source lives
	// only while the bar is open, and this bump is what re-scans it after an edit.
	$effect(() => {
		const dispose = events.on('edit', () => {
			if (decorationEngine.sourceCount > 0) void tick().then(() => decorationEngine.notifyEdit());
		});
		return () => dispose();
	});

	// `source !== lastSource` guard is load-bearing — see `docs/design/editor.md` § Reactive State Plumbing.
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
			// Reading mode has no caret for a plain click to place, so links behave
			// as in a rendered document: plain click activates.
			if (e.ctrlKey || e.metaKey || effectiveMode === 'reading') {
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

	// Clear the reveal anchor on the next user-intent gesture in the document, so it
	// holds the target only through the post-reveal settle and yields the moment the
	// user takes over. NOT on `scroll` — a programmatic correctAnchor scrollTop write
	// itself fires `scroll` and would self-clear the anchor mid-settle.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const clear = () => revealAnchor.clear();
		root.addEventListener('keydown', clear);
		root.addEventListener('pointerdown', clear);
		root.addEventListener('wheel', clear, { passive: true });
		return () => {
			root.removeEventListener('keydown', clear);
			root.removeEventListener('pointerdown', clear);
			root.removeEventListener('wheel', clear);
		};
	});

	$effect(() => {
		const handleFocusOut = (e: FocusEvent) => {
			// focusout bubbles — reset only when focus leaves the editor entirely, not
			// on a block-to-block move.
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

	// Register this editor as a body-chord claimant and track which one the user last
	// interacted with, so the document-level keydown handler routes a body-level chord
	// (the caret's block windowed out to <body>) to exactly one instance instead of
	// every mounted editor. A lone editor claims unconditionally; among several, the
	// last-interacted one wins. focusin bubbles, so any descendant focus — a block, the
	// find input, or the root's own windowed-out handoff — marks this editor. Unmount
	// relinquishes the claim and deregisters.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		registerEditor(root);
		const mark = () => markEditorInteracted(root);
		root.addEventListener('focusin', mark);
		return () => {
			root.removeEventListener('focusin', mark);
			releaseInteractedEditor(root);
			unregisterEditor(root);
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
			return directWrapper.querySelector(BLOCK_CONTENT_SELECTOR) as HTMLElement | null;
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

	// Synchronous path-descent to the mounted BlockComponent (empty path → null).
	// The non-scrolling sibling of revealPath, and the single descent both the rect
	// API and the test surface consume — a second closure would drift from it.
	function getBlockComponent(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [first, ...rest] = path;
		const ref = blockRefs[first];
		if (!ref) return null;
		if (rest.length === 0) return ref;
		return ref.getBlockComponentByPath?.(rest) ?? null;
	}

	// ── Action Bundles ──────────────────────────────────────────────────

	// Hoisted so the deps literal below can reference it before the VR state it
	// reads (editorEl/topWindowing) is declared; the body runs only at call time,
	// post-init.
	async function revealPath(path: number[]): Promise<BlockComponent | null> {
		if (path.length === 0) return null;
		const top = path[0];
		// Scroll the top-level block into its window and await its mount via the shared
		// reveal-and-wait gate: it skips an already-mounted (or out-of-doc) block, re-checks
		// after a spurious cross-level wake, and — load-bearing for VR-5 — degrades instead
		// of hanging when a stale model left `top` outside the recomputed window.
		await revealChildOrWait(top, {
			childCount: doc.children.length,
			getRef: (i) => blockRefs[i],
			revealChild: topWindowing.revealChild,
			// The windowed each-block's conditional cleanup can leave a detached
			// off-window ref in its slot; descending into it would silently no-op
			// (or hang) the reveal. Mirror the container shim: drop the stale slot
			// so the scroll + fresh mount run. isInWindow reads the effective
			// (mounted) band, so a live ref is never reported stale.
			dropRef: (i) => {
				blockRefs[i] = undefined;
			},
			isStale: (i) => !topWindowing.isInWindow(i),
			isInWindow: topWindowing.isInWindow
		});
		const ref = blockRefs[top];
		if (!ref) return null;
		if (path.length === 1) return ref;
		return ref.revealByPath
			? await ref.revealByPath(path.slice(1))
			: (ref.getBlockComponentByPath?.(path.slice(1)) ?? null);
	}

	// The instance's resolution over the global block definitions.
	// Default (no enablement door) reads the global registry verbatim, so the
	// editor is byte-identical to the pre-view behavior; a harness enablement
	// predicate filters the component (→ raw-editable) and the grammar.
	// svelte-ignore state_referenced_locally
	const registryView = createRegistryView(
		__registryEnablement ? { isEnabled: __registryEnablement } : undefined
	);

	const editorActionsDeps: EditorActionsDeps = {
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
		events,
		grammar: registryView.grammar
	};
	const { blockEdit, focus, history, containerEdit, controller } =
		createEditorActions(editorActionsDeps);

	// Reactive getter: block components call this at keystroke time to read
	// the latest doc, not the snapshot captured when they mounted.
	const getDoc: DocumentGetter = () => doc;

	// Per-instance decoration engine. Ahead of the plugin contexts (not beside
	// searchState) because the plugin door hands its registry into
	// createEditorPluginContexts below.
	const decorationEngine = createDecorationEngine({
		getDoc,
		onSourceError: (source, error) =>
			events.emit('error', { origin: 'decoration', error, context: { source } })
	});
	const decorations: DecorationRegistry = { addSource: decorationEngine.addSource };

	// Per-instance rect facet over the measurement primitives. Shares revealPath/
	// getBlockElByPath with the search deps and reuses getBlockComponent (the one
	// path-descent) so nothing measures through a second closure.
	const rects = createEditorRects({
		getBlockElByPath,
		getBlockComponentByPath: getBlockComponent,
		revealPath,
		getEditorRoot: () => editorEl ?? null,
		isCrossBlock: () => selectionState.isCrossBlock
	});

	// Per-instance plugin contexts. Placed after getDoc (not beside `events`) so it
	// reuses the one live-doc closure — a second getDoc would be a TDZ reference here,
	// and the culture rule is one getter, never a captured value.
	const editorId = mintEditorId();
	const pluginContexts = createEditorPluginContexts({
		editorId,
		getDoc,
		events,
		optionsFor: (name) => pluginEntries?.optionsByName.get(name),
		decorations,
		rects,
		// The one injection point of the mode into the dispatch tiers: both chord
		// dispatchers and the cross-block destructive branches read it back through
		// the pluginEditor lookup they already thread.
		getPresentationMode: () => effectiveMode
	});

	// The per-instance context lookup + command-error sink every dispatch tier that
	// can reach a plugin-global handler threads (leaf, cross-block, editor-root). One
	// definition so the editor-root and cross-block paths route identically.
	const pluginEditorLookup: PluginEditorLookup = (name) => pluginContexts.get(name);
	const commandErrorSink: CommandErrorSink = (report) => emitCommandError(events, report);

	// onMount, NEVER a plain $effect: attachAll synchronously runs plugin callbacks
	// that read reactive state (e.g. editor.document.children.length), so an effect
	// would register doc.children as a dependency — the first structural edit would
	// re-run it, disposing every subscription, and a run-once guard would then block
	// re-attach (the re-init-effect scar in docs/contributing/culture.md). onMount's
	// callback is once-only and non-tracking, and fires after mount so getDoc reads
	// the live $state doc.
	onMount(() => {
		pluginContexts.attachAll(({ plugin, error }) =>
			events.emit('error', { origin: 'subscriber', error, context: { plugin } })
		);
		return () => pluginContexts.dispose();
	});

	// Lifetime signal: aborted when this Editor unmounts. Document-level
	// listeners (drag-pointer) observe it to cancel mid-operation work.
	const lifetimeController = new AbortController();
	$effect(() => () => lifetimeController.abort());

	// Per-instance broken-image-URL cache: scoped here so two editors on one
	// page never leak load failures into each other's broken-state recompute.
	const brokenImageUrls = new Set<string>();

	const pasteCoordinator = createPasteCoordinator(controller);

	// Pre-search caret, snapshotted on Ctrl+F open and restored on close. Plain
	// `let` (mirrors focusedPath): only read/written from imperative handlers.
	let savedRange: Range | null = null;

	const searchReplace = createSearchReplace(editorActionsDeps, controller);
	// Find stays live in reading mode; replace is an edit and no-ops at this seam
	// (the bar's replace row is also kept collapsed below).
	const gatedSearchReplace: typeof searchReplace = {
		replaceOne: (match, template) =>
			canReplace ? searchReplace.replaceOne(match, template) : Promise.resolve(0),
		replaceAll: (matches, template) =>
			canReplace ? searchReplace.replaceAll(matches, template) : Promise.resolve(0)
	};
	const searchState = createSearchState({
		getDoc,
		decorations,
		replace: gatedSearchReplace,
		// Reveal mounts the target block (windowed-out case), then scroll the
		// active match's element into view — a no-op when already on screen, so it
		// also covers the mounted-but-scrolled-out case. getBlockElByPath resolves
		// the same path revealPath consumed; `?.` degrades to no-scroll otherwise.
		reveal: async (p) => {
			// Hold this target's screen position through the band's async image-decode
			// churn (cleared on the next user gesture) so the reveal scroll isn't
			// clamped off it — see cursor/reveal-anchor.ts.
			revealAnchor.set(p);
			await focus.revealPath(p);
			getBlockElByPath(p)?.scrollIntoView({ block: 'nearest' });
		},
		onClose: () => {
			// Restore the native single-block caret when its container is still in
			// the DOM (not windowed out, not detached by a replace). Otherwise fall
			// back to focusing the root so cross-block keyboard routing survives.
			if (savedRange && editorEl?.contains(savedRange.startContainer)) {
				const node = savedRange.startContainer;
				const host = node instanceof Element ? node : node.parentElement;
				host?.closest<HTMLElement>('[contenteditable]')?.focus();
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(savedRange);
			} else {
				editorEl?.focus();
			}
			savedRange = null;
		}
	});
	// Replace-row visibility lives here, not in SearchBar, so the root Ctrl+H
	// shortcut and the bar's chevron share one source of truth.
	let replaceExpanded = $state(false);

	const announceReorder = async (message: string) => {
		// Clear first so a repeated identical message still changes the live region's
		// text node — Svelte skips the DOM write on a ===-equal assignment, which
		// would otherwise drop the second of two identical announcements.
		reorderAnnouncement = '';
		await tick();
		reorderAnnouncement = message;
	};
	const reorder = createReorderAction(editorActionsDeps, controller, (to, total) => {
		announceReorder(`Moved block to position ${to + 1} of ${total}`);
	});

	// ── Context provision ───────────────────────────────────────────────

	// The action triple stays per-key so a container re-provides exactly the
	// bundles it overrides; HISTORY stays per-key as G1.4's single-provider
	// subject. Everything else the root provides once rides three named facets.
	setContext(BLOCK_EDIT_KEY, blockEdit);
	setContext(FOCUS_KEY, focus);
	setContext(HISTORY_KEY, history);
	setContext(CONTAINER_EDIT_KEY, containerEdit);

	setContext(EDITOR_SERVICES_KEY, {
		events,
		decorations: decorationEngine,
		selection: selectionState,
		search: searchState,
		stickyColumn,
		revealAnchor,
		widgetSelection,
		controller,
		pasteCoordinator,
		reorder,
		reorderAnnounce: announceReorder,
		registryView
	} satisfies EditorServices);

	setContext(EDITOR_POLICIES_KEY, {
		resolveImageUrl: resolveImageUrlImpl,
		resolveLinkUrl: resolveLinkUrlImpl,
		imageLoadPolicy: () => imageLoadPolicy,
		// Reading mode forces the drag handle off through the same funnel the prop
		// uses — both render sites read this one getter.
		blockDragHandles: () => blockDragHandles && effectiveMode !== 'reading',
		presentationMode: () => effectiveMode,
		keybindingOverrides: () => overridesMap,
		brokenImageUrls
	} satisfies EditorPolicies);

	// ── Root DOM effects ────────────────────────────────────────────────

	// Mode flips are blur-class events: entering reading while a reveal is open or
	// a composition is live must fold/commit through the existing blur choke
	// points (onFocusOut → commitReveal, compositionend) before the surface goes
	// inert — so blur the active element rather than invent a new fold path. The
	// change event carries the effective mode; the initial value never emits.
	// svelte-ignore state_referenced_locally
	let lastEffectiveMode = effectiveMode;
	$effect(() => {
		const mode = effectiveMode;
		if (mode === lastEffectiveMode) return;
		lastEffectiveMode = mode;
		if (mode === 'reading') {
			const active = document.activeElement;
			if (active instanceof HTMLElement && editorEl?.contains(active)) active.blur();
		}
		events.emit('presentationModeChange', mode);
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

	// A plain click edits (places the caret); only Ctrl/Cmd+click activates a
	// link. Mirror the held modifier onto the root as `data-mod-active` so CSS
	// can switch links to a pointer cursor only while the modifier is down.
	// Reset on blur / window blur / visibility loss so a modifier released while
	// the page is unfocused never sticks the pointer cursor on.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		// Track the last reflected state so ordinary typing (a keydown/keyup per
		// keystroke) never touches the DOM — the attribute write stays off the
		// keystroke hot path (perf:check), firing only when the modifier changes.
		let active = false;
		const apply = (next: boolean) => {
			if (next === active) return;
			active = next;
			if (next) root.setAttribute('data-mod-active', '');
			else root.removeAttribute('data-mod-active');
		};
		const onKey = (e: KeyboardEvent) => apply(e.ctrlKey || e.metaKey);
		const reset = () => apply(false);
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') apply(false);
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('keyup', onKey);
		window.addEventListener('blur', reset);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('keyup', onKey);
			window.removeEventListener('blur', reset);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	// Drag-to-reorder: a delegated handle-drag on the editor root. Installed once
	// editorEl is bound; torn down on unmount via the lifetime signal.
	$effect(() => {
		if (!editorEl) return;
		const handle = installReorderDrag({
			editorRoot: editorEl,
			moveReorderUnit: reorder.moveReorderUnit,
			overlay: {
				setGhost: (g) => (reorderGhost = g),
				setLine: (l) => (reorderLine = l)
			},
			lifetimeSignal: lifetimeController.signal
		});
		return () => handle.dispose();
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

	// ── Editor-root keydown routing ──────────────────────────────────────
	//
	// When the caret's block windows out, native focus drops to <body> and the
	// per-block keydown handlers go silent. This editor-scope handler reuses the
	// same cross-block composer the blocks use, reading every live value off
	// `selection`/`getDoc`/etc. — `getEl` is only a mount guard and `getMyPath`
	// only a fallback, so the editor root and the focus path stand in.
	const editorCrossBlock = createCrossBlockHandlers({
		getEl: () => editorEl ?? null,
		getMyPath: () => selectionState.focus?.path ?? [],
		getIndex: () => selectionState.focus?.path?.[0] ?? 0,
		selection: selectionState,
		getDoc,
		getBlockElByPath,
		revealPath,
		getEditorRoot: () => editorEl ?? null,
		getEditorLifetime: () => lifetimeController.signal,
		stickyColumn,
		blockEdit,
		controller,
		history,
		pluginEditor: pluginEditorLookup,
		getPresentationMode: () => effectiveMode,
		onCommandError: commandErrorSink,
		pasteCoordinator,
		getKeybindingOverrides: () => overridesMap,
		grammar: registryView.grammar,
		getCursorOffset: () => selectionState.focus?.offset ?? null,
		afterReactivity: () => tick()
	});

	// Document-level chords for the windowed-out caret — no mounted block consumed
	// them. A focused block handles its own keys first; this fires when the caret's
	// block scrolled out (undo/redo, plugin-global chords, cross-block motion) plus
	// the search shortcuts, which route from anywhere inside this editor. Every arm
	// is contained to THIS instance: the listener sees every editor's keystrokes on
	// the page, so an unguarded handler let one Ctrl+Z revert two editors and an
	// outside-input Ctrl+F steal focus into this editor's search bar.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const onKeyDown = (e: KeyboardEvent) => {
			// eventToChord normalizes the key (CapsLock uppercases e.key without
			// Shift), matching every other chord-dispatch site.
			const rootChord = eventToChord(e);
			const active = root.ownerDocument.activeElement;

			// Search / Escape: focus INSIDE this editor (a block, the find input, or the
			// root), or a search chord this instance claims. claimsBodyChord is true for
			// the sole editor (or, among several, the last-interacted one), so a lone
			// editor claims Find/Replace page-wide — even with focus on a sibling toolbar
			// control — restoring the pre-containment behavior; a second mounted editor
			// can't steal it (an outside-focus Ctrl+F opens no bar when 2+ editors exist).
			// The one exception: a foreign text-entry surface (a consumer's own
			// <textarea>/<input>/contenteditable) owns page-global Ctrl+F while the user
			// types in it, so the editor yields there rather than hijacking it.
			if (root.contains(active) || (claimsBodyChord(root) && !isForeignTextEntry(active))) {
				if (searchBar && rootChord && isReservedUiChord(rootChord)) {
					e.preventDefault();
					// Seed the query from the live native selection before open() —
					// focusing the find input collapses it. Guard the saved-caret
					// snapshot on !isOpen so a repeat Mod+F (focus already in the find
					// input) can't clobber the pre-search caret with the collapsed one.
					const sel = window.getSelection();
					const selected = sel?.toString() ?? '';
					if (!searchState.isOpen) {
						savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
					}
					replaceExpanded = rootChord === 'Mod+H' && canReplace;
					searchState.open();
					if (selected) searchState.setQuery(selected);
					return;
				}
				if (e.key === 'Escape' && searchState.isOpen) {
					e.preventDefault();
					searchState.close();
					return;
				}
			}

			// Undo/redo, plugin-global chords, cross-block motion fire only when NO block
			// holds focus: active === root (the caret's block windowed out and parked on
			// THIS root, unique per editor), or nothing focused (body/null — windowed out
			// and blurred to a page-shared target, claimed by the sole/last-interacted
			// editor). Unlike the search chords above, these collide with a focused
			// outside element's native behavior — a text input owns Ctrl+Z — so they
			// yield to any focused element and act only on the windowed-out caret.
			const noElementFocused = active === null || active === root.ownerDocument.body;
			if (!(active === root || (noElementFocused && claimsBodyChord(root)))) return;

			// Undo/redo fire regardless of cross-block: the inert case is a collapsed
			// caret whose block unmounted, not necessarily a selection. No block is
			// focused here, so resolve at global scope (consumer override, else default).
			// This branch runs getCommand directly (no dispatchKeyCommand), so it
			// carries the reading-mode gate itself — sibling: ThematicBreakBlock.
			if (rootChord && isEditorGlobalChord(rootChord)) {
				e.preventDefault();
				if (effectiveMode === 'reading') return;
				const binding = resolveGlobalBinding(rootChord, overridesMap);
				if (binding)
					getCommand(binding.command)?.({
						history,
						pluginEditor: pluginEditorLookup,
						onCommandError: commandErrorSink
					});
				return;
			}

			if (selectionState.isCrossBlock) void editorCrossBlock.handleKeyDown(e);
		};
		root.ownerDocument.addEventListener('keydown', onKeyDown);
		return () => root.ownerDocument.removeEventListener('keydown', onKeyDown);
	});

	// ── Virtual rendering (top-level windowing) ──────────────────────────

	const heightOracle = createHeightOracle({
		lineHeight: HEIGHT_ESTIMATES.proseLineHeight,
		codeLineHeight: HEIGHT_ESTIMATES.codeLineHeight,
		avgCharWidth: HEIGHT_ESTIMATES.avgCharWidth,
		blockChrome: HEIGHT_ESTIMATES.blockChrome,
		imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
	});

	// A WIDTH change re-wraps prose, so every height the oracle cached at the old width
	// is stale and every windowing scope must rebuild + re-measure. The editor root owns
	// one ResizeObserver on its scroll element; on a real width delta it clears the
	// oracle's measured cache and bumps this counter, which the scopes read to rebuild
	// (and which anchor-corrects the reflow so the viewport stays put). A height-only
	// resize doesn't re-wrap, so it's ignored. ResizeObserver's per-callback batching is
	// the coalescing — no setTimeout/rAF debounce (G4.4).
	let widthVersion = $state(0);
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

	// `data-focused` marks the block host whose leaf holds the caret; both preview
	// modes' CSS key their focused-block reveal off it. Set imperatively (like
	// focusedPath, and for the same teardown-safety reason), gated on the effective
	// mode so source/reading DOM stays byte-identical — a click that reveals markers
	// must not alter the other modes' markup. The attribute lives on the same element
	// the focus pin resolves; the two are updated together.
	let focusedHostEl: HTMLElement | null = null;
	function applyFocusedAttr(): void {
		if (focusedHostEl && isPreviewMode(effectiveMode)) {
			focusedHostEl.setAttribute('data-focused', '');
		} else {
			focusedHostEl?.removeAttribute('data-focused');
		}
	}
	function setFocusedHost(host: HTMLElement | null): void {
		if (focusedHostEl === host) return;
		focusedHostEl?.removeAttribute('data-focused');
		focusedHostEl = host;
		applyFocusedAttr();
	}
	// Reconcile the attribute when the mode flips: entering a preview mode marks the
	// already-focused block (no re-focus fires), leaving both cleans the attribute off.
	$effect(() => {
		void effectiveMode;
		applyFocusedAttr();
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const onFocusIn = (e: FocusEvent) => {
			const host = (e.target as Element | null)?.closest('[data-block-path]');
			if (!host || !root.contains(host)) {
				focusedPath = null;
				setFocusedHost(null);
				return;
			}
			setFocusedHost(host as HTMLElement);
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
			setFocusedHost(null);
		};
		root.addEventListener('focusin', onFocusIn);
		root.addEventListener('focusout', onFocusOut);
		return () => {
			root.removeEventListener('focusin', onFocusIn);
			root.removeEventListener('focusout', onFocusOut);
		};
	});
	// The document facet is assembled here, after the windowing signals it carries
	// (heightOracle, widthVersion, focusedPath) exist — the block components and the
	// windowing hook below both read it back through getContext.
	setContext(EDITOR_DOC_KEY, {
		doc: getDoc,
		linkRef: {
			get current(): LinkReferenceResolver {
				return currentResolver;
			},
			get signature(): string {
				return currentSignature;
			}
		},
		pluginEditor: pluginEditorLookup,
		lifetime: lifetimeController.signal,
		editorRoot: () => editorEl ?? null,
		blockElLookup: getBlockElByPath,
		focusedPath: () => focusedPath,
		heightOracle,
		widthVersion: () => widthVersion
	} satisfies EditorDoc);

	// The root sources the doc facet (heightOracle/focusedPath/editorRoot) above; the
	// hook reads it back via getContext. getListEl is the inner .block-list wrapper, not
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

	export function getEvents(): EditorEvents {
		return events;
	}

	export function getSearch(): SearchState {
		return searchState;
	}

	export function getDecorations(): DecorationRegistry {
		return decorations;
	}

	export function getRects(): EditorRects {
		return rects;
	}

	// One-line selection summary for the field report — the public snapshot, so it
	// covers single-block carets the cross-block SelectionState never holds.
	function selectionSummary(): string {
		const sel = getSelection();
		if (!sel) return '(no selection)';
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		return `anchor=${fmt(sel.anchor)} focus=${fmt(sel.focus)}`;
	}

	export function getDiagnostics(): EditorDiagnostics {
		return {
			enableTrace: enableInteractionTrace,
			disableTrace: disableInteractionTrace,
			isTraceEnabled: isInteractionTraceEnabled,
			traceSnapshot: interactionTraceSnapshot,
			serializeDiagnostics: (opts) => {
				const includeSource = opts?.includeSource ?? false;
				return buildDiagnosticsReport({
					timestamp: new Date().toISOString(),
					trace: dumpInteractionTrace(interactionTraceSnapshot()),
					opsLog: dumpOperationsLog(operationsLog),
					selection: selectionSummary(),
					// Serialize only when opted in — the report stays document-free by default.
					source: includeSource ? getSource() : '',
					includeSource
				});
			}
		};
	}

	// Compile-time conformance: the published handle can't drift from the exports.
	void ({
		getSource,
		getSelection,
		getEvents,
		getSearch,
		getDecorations,
		getRects,
		getDiagnostics
	} satisfies EditorInstance);

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

	export const __test = {
		getDocument,
		getBlockComponent,
		getUndoStack,
		getOperationsLog,
		// Deterministically constructs the stale-slot artifact the windowed
		// each-block's conditional cleanup can leave behind (see revealPath's
		// isStale wiring); e2e-only, via test-probes' replantBlockRef.
		setBlockRefSlot
	};
</script>

<!-- tabindex="-1": focusable so a windowed-out block can hand focus here instead
	of letting it fall to <body>, but not tab-reachable. Non-editable, so focusing
	it creates no native selection the selectionchange bridge would collapse. -->
<!-- data-presentation is ABSENT in source mode on purpose: the default path's
	DOM stays byte-identical to the pre-mode editor; reading-mode CSS keys on the
	attribute's presence. -->
<div
	class="editor"
	data-editor-theme={theme}
	data-presentation={effectiveMode === 'source' ? undefined : effectiveMode}
	bind:this={editorEl}
	tabindex="-1"
	role="group"
	aria-label="Markdown editor"
>
	{#if searchBar}
		<!-- Zero-height sticky anchor: pins the absolutely-positioned bar to the
		     scrollport top so it doesn't scroll away with content on next/prev. -->
		<div class="search-anchor">
			<SearchBar
				replaceExpanded={replaceExpanded && canReplace}
				onToggleReplace={() => (replaceExpanded = canReplace && !replaceExpanded)}
			/>
		</div>
	{/if}
	<BlockList
		children={doc.children}
		{blockIds}
		setRef={setBlockRefSlot}
		getRef={getBlockRefSlot}
		parentPath={[]}
		window={topWindowing.window}
		reorderable={true}
	/>
	<ImageOverlayHost
		{widgetSelection}
		{controller}
		{events}
		{getDoc}
		getEditorEl={() => editorEl ?? null}
		getSelectionIsCustomRendered={() => selectionState.isCustomRendered}
		getPresentationMode={() => effectiveMode}
		lifetime={lifetimeController.signal}
	/>
	<div class="editor-sr-live" role="status" aria-live="polite">{selectionDescription}</div>
	<div class="editor-sr-live-reorder" role="status" aria-live="polite">{reorderAnnouncement}</div>
	{#if reorderLine}
		<div
			class="reorder-line"
			style="left:{reorderLine.left}px;top:{reorderLine.top}px;width:{reorderLine.width}px"
		></div>
	{/if}
	{#if reorderGhost}
		<div class="reorder-ghost" style="left:{reorderGhost.clientX}px;top:{reorderGhost.clientY}px">
			{reorderGhost.label}
		</div>
	{/if}
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
		   line; do NOT restore `overflow-anchor` (VR-2). */
		overflow-anchor: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #a4a4a4) transparent;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		/* Containing block for the image overlay portal. */
		position: relative;
	}

	/* Sticks to the scrollport top (height:0 reserves no space); the search bar
	   positions absolutely against it, so it stays put as the editor scrolls. */
	.search-anchor {
		position: sticky;
		top: 0;
		height: 0;
		z-index: 5;
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

	.editor-sr-live,
	.editor-sr-live-reorder {
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

	/* Active reorder scope: a nested drag reorders only within its container, so the
	   container gets a faint, transient wash for the drag's duration — just enough to
	   read as "reordering within here", deliberately NOT an outline/box (a document
	   should feel like a document, not a pile of blocks). Added/removed by
	   editor-actions/reorder-drag.ts. */
	:global(.reorder-scope) {
		background: var(--reorder-scope-bg, rgba(100, 150, 255, 0.14));
		border-radius: 4px;
		transition: background-color 0.12s ease;
	}

	/* Drag overlay: viewport-fixed (rects come from getBoundingClientRect /
	   pointer client coords); pointer-events:none so they never intercept the
	   drag's own pointer stream. */
	.reorder-line {
		position: fixed;
		height: 2px;
		background: var(--md-reorder-indicator);
		border-radius: 2px;
		pointer-events: none;
		z-index: 20;
	}

	.reorder-ghost {
		position: fixed;
		transform: translate(0.75rem, 0.5rem);
		max-width: 16rem;
		padding: 0.15rem 0.5rem;
		font-size: 0.85em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		background: var(--md-reorder-indicator);
		color: #fff;
		border-radius: 4px;
		opacity: 0.9;
		pointer-events: none;
		z-index: 21;
	}
</style>
