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
		type LinkReferenceResolverRef,
		type EditorPolicies,
		type EditorServices,
		type PluginEditorLookup,
		type ResolveImageUrl,
		type ResolveLinkUrl
	} from '../editor-keys';
	import { createStickyColumnState } from '../cursor/sticky-column';
	import { createEdgeAffinityState } from '../cursor/edge-affinity';
	import { createPendingMarksState } from '../cursor/pending-marks';
	import { createRevealAnchorState } from '../cursor/reveal-anchor';
	import { createHeightOracle } from '../cursor/height-oracle';
	import { ESTIMATE_BASE_FONT_SIZE, HEIGHT_ESTIMATES } from '../cursor/typography-estimates';
	import {
		clippingAncestors,
		userScrollportFor,
		type UserScrollport
	} from '../cursor/scroll-ancestors';
	import { createDeadSpaceCaret } from '../selection/dead-space-caret';
	import { resetForPointerDown } from '../selection/cross-block/pointer';
	import { createContentVersion } from '../reactivity/content-version.svelte';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { refSlotsOver, revealChildOrWait } from '../reactivity/publish-ref.svelte';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { createSelectionDescription } from '../selection/selection-description';
	import { EDITOR_LABEL, movedBlockToPosition } from '../a11y-strings';
	import type { EditorSelection } from '../selection/primitives';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../block-id';
	import { ensureEditableContainers, emptyParagraph } from '../tree-operations';
	import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
	import { serialize } from '../core/serializer';
	import { parse } from '../core/parser';
	import { defaultLinkActivation } from '../core/url-policy';
	import { advanceSignatureEpoch, lrdMapCouldChange } from './lrd-map-gate';
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
	import { restoreSelection, type SelectionRestoreOutcome } from '../selection/selection-restore';
	import {
		findBlockPathForElement,
		findCellPathForElement,
		readBlockPath
	} from '../selection/path-lookup';
	import { createCaretRestore } from '../selection/caret-restore';
	import { createCrossBlockHandlers } from '../selection/cross-block/dispatch';
	import { isPreviewMode } from '../presentation-mode';
	import { normalizeKeybindingOverrides } from '../schema/keybinding-overrides';
	import { createEditorRootKeydown } from './editor-root-keydown';
	import { createEditorRootClipboard } from './editor-root-clipboard';
	import { collectReservedChords, chordIsClaimed } from '../schema/reserved-chords';
	import { portalInto } from './portal';
	import {
		registerEditor,
		unregisterEditor,
		markEditorInteracted,
		releaseInteractedEditor
	} from '../active-editor';
	import type { CommandErrorSink } from '../schema/block-commands';
	import { installPlugins, normalizePluginEntries } from '../schema/plugin-install';
	import { createEditorPluginContexts, mintEditorId } from '../schema/plugin-editor-context';
	import { createRegistryView, type KindEnablement } from '../schema/registry-view';
	import BlockList from './BlockList.svelte';
	import SearchBar from './SearchBar.svelte';
	import ImageOverlayHost from './image/ImageOverlayHost.svelte';
	import LinkCardHost from './link-card/LinkCardHost.svelte';
	import { createLinkCardState } from './link-card/link-card-state.svelte';
	import { LINK_ELEMENT_SELECTOR, resolveLinkAtPoint } from './blocks/text/link-at-point';
	import { runStartupInvariantChecks } from '../invariants/install';
	import { registerBuiltInBlocks } from './built-in-blocks';
	import { BLOCK_CONTENT_SELECTOR } from './block-content-selector';

	registerBuiltInBlocks();
	bootstrapCodeLanguages();
	runStartupInvariantChecks();

	// `__registryEnablement` is a harness-only door; the intersection keeps it off the
	// public EditorProps type.
	let {
		source = '',
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy = 'auto',
		onLinkActivate,
		onPasteImage,
		header,
		blockDragHandles = true,
		searchBar = true,
		searchBarAnchor,
		keybindings,
		theme = 'dark',
		presentationMode = 'source',
		scrollMode = 'self',
		plugins,
		__registryEnablement
	}: EditorProps & { __registryEnablement?: KindEnablement } = $props();

	// Snapshotted, not read live: set-once by contract, and a live read inside the
	// windowing scopes' derived would make `scrollMode` a dependency of the hottest path.
	// svelte-ignore state_referenced_locally
	const hostScroll = scrollMode === 'host';

	// Host mode asks two different questions one walk cannot serve (`cursor/
	// scroll-ancestors` header): what a drag autoscrolls, and what bounds the visible
	// region. Memoized on first read, so a host that swaps its scroller must remount.
	let resolvedScrollHost: UserScrollport | null = null;
	let resolvedClipBounds: HTMLElement[] = [];
	let hostResolved = false;
	function resolveHost(): void {
		if (hostResolved || !editorEl) return;
		resolvedScrollHost = userScrollportFor(editorEl);
		resolvedClipBounds = clippingAncestors(editorEl);
		hostResolved = true;
	}
	/** What a drag autoscrolls: the root in self mode, the nearest scrollable ancestor
	 *  in host mode. Null only before the root mounts. */
	function getScrollHost(): UserScrollport | null {
		if (!hostScroll) return editorEl ?? null;
		resolveHost();
		return resolvedScrollHost;
	}
	/** Every clipping ancestor; their intersection with the viewport is what a reveal
	 *  must land inside. */
	function getClipBounds(): HTMLElement[] {
		if (!hostScroll) return [];
		resolveHost();
		return resolvedClipBounds;
	}

	// Install before initDocument parses `source`, so plugin openers/directives are live
	// for the seed grammar. Set-once by contract — a later prop change is ignored.
	// svelte-ignore state_referenced_locally
	const pluginEntries = plugins?.length ? normalizePluginEntries(plugins) : undefined;
	if (pluginEntries) installPlugins(pluginEntries.plugins);

	const overridesMap = $derived(normalizeKeybindingOverrides(keybindings));

	// The one mode every door reports (root attribute, context getter, plugin contexts,
	// events), and the seam an effective-vs-requested divergence would land in.
	const effectiveMode = $derived(presentationMode);
	// Replace is an edit, so it never engages in reading mode. One predicate feeds the
	// write sites, the render gate, and the replace closures.
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
		const d = parse(src, { scope: 'document' });
		if (d.children.length === 0) {
			// Only the empty source parses to zero blocks — a blank line is a block of its
			// own — so there is no authored ending to inherit and LF is the whole answer.
			d.children.push(emptyParagraph('', '\n'));
		}
		for (const child of d.children) {
			ensureEditableContainers(child);
		}
		const refMap = buildLinkReferenceMap(d.children);
		return { doc: d, resolver: refMap.resolve, signature: refMap.signature };
	}

	// doc/blockIds are mutable state structural ops write through directly, so they
	// cannot be $derived: snapshot at mount, re-sync via the $effect below.
	// svelte-ignore state_referenced_locally
	const initial = initDocument(source);
	let doc = $state<Document>(initial.doc);
	// svelte-ignore state_referenced_locally
	let blockIds = $state<string[]>(assignIds(doc.children));
	let currentResolver = $state<LinkReferenceResolver>(initial.resolver);
	let currentSignature = $state<string>(initial.signature);
	// Reference-bearing render memos key on this instead of the whole (~MB) signature.
	let signatureEpoch = $state<number>(0);
	/** One ref for every reader — the block components through context and the action bundles
	 *  through their deps — so a post-commit rebuild reaches both without re-binding either. */
	const linkRefView: LinkReferenceResolverRef = {
		get current(): LinkReferenceResolver {
			return currentResolver;
		},
		get signature(): string {
			return currentSignature;
		},
		get epoch(): number {
			return signatureEpoch;
		}
	};
	// Plain array: $state's mutation guards revert writes from a BlockHost publish
	// that fires during the post-undo reactive flush.
	let blockRefs: (BlockComponent | undefined)[] = [];
	const blockRefSlots = refSlotsOver(() => blockRefs);
	let editorEl: HTMLDivElement | undefined = $state();
	let headerEl: HTMLDivElement | undefined = $state();
	let typeScaleProbeEl: HTMLDivElement | undefined = $state();
	const undoManager = createUndoManager();
	const sharing = createSharingState();
	const stickyColumn = createStickyColumnState();
	// Composed, not wired seam by seam: the marks are ephemeral caret state with the affinity's
	// exact lifetime, so every door that invalidates the arrival side drops them by construction.
	const pendingMarks = createPendingMarksState();
	const edgeAffinity = createEdgeAffinityState({ onInvalidate: pendingMarks.reset });
	const revealAnchor = createRevealAnchorState();
	const operationsLog = createOperationsLog();
	const events = createEditorEvents();
	// getSelection is function-hoisted below — callback reads the fresh snapshot each time.
	const selectionState = createSelectionState({
		onChange: () => {
			// The other half of the mutual exclusion `onSelect` carries: a range opened while a
			// widget is selected (select-all declines to the widget's own keydown) would leave
			// both live, and every dispatch keyed on "a widget is selected" would answer for
			// the document-wide selection the user is looking at.
			if (selectionState.isCrossBlock) widgetSelection.clear();
			events.emit('selectionChange', getSelection());
		},
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

	// Its own polite region: clobbering selectionDescription would drop the move from
	// the a11y tree.
	let reorderAnnouncement = $state('');

	// Single elements, not per-block, so the hover/drag path adds no cost per mounted
	// component.
	let reorderGhost = $state<{ clientX: number; clientY: number; label: string } | null>(null);
	let reorderLine = $state<{ left: number; top: number; width: number } | null>(null);

	$effect(() => {
		const dispose = events.on('edit', (e) => {
			operationsLog?.record({
				op: e.op,
				path: e.path,
				detail: ('detail' in e ? e.detail : undefined) ?? {}
			});
			// The shell maintains only the LRD resolver (inline content computes lazily
			// on read — core/inline/inline-cache), and hands out a fresh identity only on
			// a real signature change: one per edit re-renders every block that read it.
			if (lrdMapCouldChange(doc, e)) {
				const newMap = buildLinkReferenceMap(doc.children);
				const next = advanceSignatureEpoch(currentSignature, signatureEpoch, newMap.signature);
				if (next.epoch !== signatureEpoch) {
					currentResolver = newMap.resolve;
					currentSignature = next.signature;
					signatureEpoch = next.epoch;
				}
			}
		});
		return () => dispose();
	});

	// The one bump site for `editEpoch` ("the document changed" — a commit or a whole
	// `source` swap). Deferred a tick so no source reads a half-applied tree, and
	// skipped with no source registered: zero keystroke work by default (perf:check).
	function notifyDocumentChanged(): void {
		if (decorationEngine.sourceCount > 0) void tick().then(() => decorationEngine.notifyEdit());
	}

	$effect(() => {
		const dispose = events.on('edit', () => notifyDocumentChanged());
		return () => dispose();
	});

	// Counts whole-document REPLACEMENTS, which the edit epoch cannot tell from a
	// keystroke. Deliberately NOT $state: its readers run inside decoration `provide`,
	// which must register no reactive dependency.
	let documentGeneration = 0;

	// `source !== lastSource` guard is load-bearing — see `docs/design/editor.md` § Reactive State Plumbing.
	// svelte-ignore state_referenced_locally
	let lastSource = source;
	$effect(() => {
		if (source !== lastSource) {
			// A pending typing batch addresses the OUTGOING document, so it flushes
			// while its path still resolves; left armed, the timer fires note A's path
			// against note B.
			controller.flushDebouncedCheckpoint();
			lastSource = source;
			const reset = initDocument(source);
			doc = reset.doc;
			blockIds = assignIds(doc.children);
			blockRefs = [];
			undoManager.clear();
			stickyColumn.reset();
			edgeAffinity.reset();
			selectionState.clear();
			documentGeneration++;
			// The resolver refreshes unconditionally — the old one closes over the
			// swapped-out doc — but the epoch bumps only on a differing LRD signature.
			const next = advanceSignatureEpoch(currentSignature, signatureEpoch, reset.signature);
			currentResolver = reset.resolver;
			currentSignature = next.signature;
			signatureEpoch = next.epoch;
			notifyDocumentChanged();
		}
	});

	// ── Listener ritual ─────────────────────────────────────────────────
	//
	// Every root listener installs on an $effect and removes on its teardown. Retyping
	// that pair per site is how a cleanup drifts, so these two capture the target and
	// the handler once. Typed off `Event`, not the per-target event maps: those names
	// are type-only, and this file runs on ESLint's untyped net.

	function onRoot<E extends Event>(
		target: EventTarget,
		type: string,
		handler: (event: E) => void,
		options?: { capture?: boolean; passive?: boolean }
	): () => void {
		const listener = handler as (event: Event) => void;
		target.addEventListener(type, listener, options);
		// Removal matches on capture alone: `passive` is an add-time hint the remove
		// signature rejects.
		return () => target.removeEventListener(type, listener, options?.capture);
	}

	function removeAll(...removers: (() => void)[]): () => void {
		return () => removers.forEach((remove) => remove());
	}

	/**
	 * The host's own chrome, mounted inside this root. Every rule meaning "this is the
	 * editor's own CONTENT" asks here rather than carrying its own `contains` copy,
	 * which is how one gets missed. The focusout guards keep using `contains` — for
	 * "did focus leave the whole widget", the slot IS part of the editor.
	 */
	function isHostChrome(node: Node | null): boolean {
		return !!node && !!headerEl && headerEl.contains(node);
	}

	// A click in the root's padding or below the last block places a caret rather than
	// doing nothing. `getBlockComponent` is hoisted; the reset closure defers its reads.
	const deadSpaceCaret = createDeadSpaceCaret({
		getBlockComponent,
		resetSelectionForClick: () =>
			resetForPointerDown(selectionState, stickyColumn, edgeAffinity, false),
		gapScope: {
			getDoc: () => doc,
			selection: selectionState,
			getPresentationMode: () => effectiveMode
		}
	});

	const linkCard = createLinkCardState();

	/** Open the card on the link `el` renders, or report that nothing there is one. The caret has
	 *  already landed from mousedown; it is saved here so Escape can put it back. */
	function openLinkCard(el: Element): boolean {
		const path = findCellPathForElement(el) ?? findBlockPathForElement(el);
		if (!path) return false;
		const block = nodeAt(doc, path);
		if (block === null || !isBlockNode(block)) return false;
		const contentEl = getBlockElByPath(path);
		if (!contentEl) return false;
		const hit = resolveLinkAtPoint({ contentEl, block, path, linkRef: linkRefView });
		if (!hit) return false;
		caretRestore.saveCurrent();
		linkCard.open(hit.target);
		return true;
	}

	// The card belongs to live mode alone; any other mode paints the destination bytes already.
	$effect(() => {
		if (effectiveMode !== 'live') linkCard.close();
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const handleClick = (e: MouseEvent) => {
			const target = e.target as Element | null;
			// Ahead of the anchor arm: a blocked-scheme link renders as a SPAN, and it is exactly
			// the link a user opens the card to fix. Mod-click still activates, below.
			if (effectiveMode === 'live' && !e.ctrlKey && !e.metaKey) {
				const linkEl = target?.closest(LINK_ELEMENT_SELECTOR);
				if (linkEl && !isHostChrome(linkEl) && openLinkCard(linkEl)) {
					e.preventDefault();
					return;
				}
			}
			const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
			// The helper claims only clicks whose target IS the root, so nothing the
			// editor renders is touched.
			if (!anchor) {
				deadSpaceCaret.handleClick(root, e);
				return;
			}
			// Host chrome follows the page's link behaviour, not plain-click-edits.
			if (isHostChrome(anchor)) return;
			const href = anchor.getAttribute('href');
			if (!href) return;
			// Reading mode has no caret for a plain click to place, so links behave as
			// in a rendered document.
			if (e.ctrlKey || e.metaKey || effectiveMode === 'reading') {
				e.preventDefault();
				activateLink(href, e);
			} else {
				// Suppress the browser's link navigation; cursor placement comes from
				// mousedown and is unaffected.
				e.preventDefault();
			}
		};
		return removeAll(
			onRoot(root, 'click', handleClick),
			onRoot(root, 'mousedown', (e: MouseEvent) => deadSpaceCaret.notePress(root, e))
		);
	});

	// Release on the next user-intent gesture, so the anchor holds only through the
	// post-reveal settle. NOT on `scroll`: a programmatic correctAnchor write fires
	// `scroll` itself and would self-release the anchor mid-settle.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const release = () => revealAnchor.releaseAll();
		return removeAll(
			onRoot(root, 'keydown', release),
			onRoot(root, 'pointerdown', release),
			onRoot(root, 'wheel', release, { passive: true })
		);
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		// focusout bubbles, so reset only when focus leaves the editor entirely.
		return onRoot(root, 'focusout', (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return;
			stickyColumn.reset();
			edgeAffinity.reset();
		});
	});

	// Its own effect: this reads no root binding, so pairing it with the focusout one
	// would make it wait for the bind and re-install on every root change.
	$effect(() =>
		onRoot(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				stickyColumn.reset();
				edgeAffinity.reset();
			}
		})
	);

	// Register as a body-chord claimant so the document-level keydown handler routes a
	// body-level chord to exactly one instance: a lone editor claims unconditionally,
	// among several the last-interacted one wins.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		registerEditor(root);
		const removeMark = onRoot(root, 'focusin', () => markEditorInteracted(root));
		return () => {
			removeMark();
			releaseInteractedEditor(root);
			unregisterEditor(root);
		};
	});

	// The measurement surface for cross-block caret math. Table cells carry no
	// data-block-path (they render without BlockHost), so a deep cell path resolves
	// the table wrapper and walks into the cell DOM.
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

	// The non-scrolling sibling of revealPath, and the one descent both the rect API
	// and the test surface consume — a second closure would drift from it.
	function getBlockComponent(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [first, ...rest] = path;
		const ref = blockRefs[first];
		if (!ref) return null;
		if (rest.length === 0) return ref;
		return ref.getBlockComponentByPath?.(rest) ?? null;
	}

	// ── Action Bundles ──────────────────────────────────────────────────

	// Hoisted so the deps literal below can reference it before the VR state it reads
	// is declared; the body runs only at call time, post-init.
	async function revealPath(path: number[]): Promise<BlockComponent | null> {
		if (path.length === 0) return null;
		const top = path[0];
		// The shared reveal-and-wait gate skips an already-mounted block, re-checks after
		// a spurious cross-level wake, and — load-bearing for VR-5 — degrades instead of
		// hanging when a stale model left `top` outside the recomputed window.
		await revealChildOrWait(top, {
			slots: blockRefSlots,
			childCount: doc.children.length,
			revealChild: topWindowing.revealChild,
			// The windowed each-block's conditional cleanup can strand a detached ref in
			// its slot, which would silently no-op the reveal; `isStale` drops it so the
			// scroll and a fresh mount run.
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

	// The instance's resolution over the global block definitions: without an
	// enablement door it reads the global registry verbatim.
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
		blockRefSlots,
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
		edgeAffinity,
		selectionState,
		getBlockElByPath,
		revealPath,
		events,
		grammar: registryView.grammar,
		getPresentationMode: () => effectiveMode,
		get linkRef() {
			return linkRefView;
		}
	};
	const { blockEdit, focus, history, containerEdit, controller } =
		createEditorActions(editorActionsDeps);

	// A getter, so block components read the live doc at keystroke time rather than
	// the snapshot they mounted with.
	const getDoc: DocumentGetter = () => doc;

	// The edit epoch's twin at render cadence: a keystroke changes this immediately,
	// while `editEpoch` waits for the typing batch to flush. Inline widgets derive at
	// render cadence and need this one. Lazy — nothing computes until a reader asks.
	const contentVersion = createContentVersion(getDoc);

	// Ahead of the plugin contexts because the plugin door hands its registry into
	// createEditorPluginContexts below.
	const decorationEngine = createDecorationEngine({
		getDoc,
		onSourceError: (source, error) =>
			events.emit('error', { origin: 'decoration', error, context: { source } })
	});
	const decorations: DecorationRegistry = { addSource: decorationEngine.addSource };

	// Reuses revealPath/getBlockElByPath/getBlockComponent so nothing measures through
	// a second closure.
	const rects = createEditorRects({
		getBlockElByPath,
		getBlockComponentByPath: getBlockComponent,
		revealPath,
		getEditorRoot: () => editorEl ?? null,
		isHostScroll: () => hostScroll,
		getClipBounds,
		isCrossBlock: () => selectionState.isCrossBlock,
		isHostChrome,
		revealAnchor,
		// A navigation holds its pin, unlike the consumer restore door: nothing follows
		// it that wants the viewport back, and the band should outlive a late decode.
		landCaretAt: async (path) => (await restoreThroughRevealRoad(caretAt(path), true)) === 'applied'
	});

	// After getDoc so it reuses that one live-doc closure: a second getDoc would be a
	// TDZ reference here, and the rule is one getter, never a captured value.
	const editorId = mintEditorId();
	const pluginContexts = createEditorPluginContexts({
		editorId,
		getDoc,
		events,
		optionsFor: (name) => pluginEntries?.optionsByName.get(name),
		decorations,
		rects,
		// The one injection point of the mode into the dispatch tiers; they read it back
		// through the pluginEditor lookup they already thread.
		getPresentationMode: () => effectiveMode,
		getTheme: () => theme
	});

	// One definition, threaded by every dispatch tier that can reach a plugin-global
	// handler, so leaf, cross-block and editor-root route identically.
	const pluginEditorLookup: PluginEditorLookup = (name) => pluginContexts.get(name);
	const commandErrorSink: CommandErrorSink = (report) => emitCommandError(events, report);

	// onMount, NEVER a plain $effect: attachAll synchronously runs plugin callbacks that
	// read reactive state, so an effect would take doc.children as a dependency and the
	// first structural edit would dispose every subscription (culture.md's re-init scar).
	onMount(() => {
		pluginContexts.attachAll(({ plugin, error }) =>
			events.emit('error', { origin: 'subscriber', error, context: { plugin } })
		);
		return () => pluginContexts.dispose();
	});

	// Aborted on unmount; document-level listeners observe it to cancel mid-operation work.
	const lifetimeController = new AbortController();
	$effect(() => () => {
		// Same reason as the source swap: a timer outliving the component emits into
		// subscribers the host still holds, for a document that is gone.
		controller.flushDebouncedCheckpoint();
		lifetimeController.abort();
	});

	// Per-instance so two editors on one page never leak load failures into each
	// other's broken-state recompute.
	const brokenImageUrls = new Set<string>();

	const pasteCoordinator = createPasteCoordinator(controller, revealPath);

	// The document caret while chrome holds focus. Search opened this closure; the link card is its
	// second door (selection/caret-restore.ts).
	const caretRestore = createCaretRestore(() => editorEl ?? null);

	const searchReplace = createSearchReplace(editorActionsDeps, controller);
	// Find stays live in reading mode; replace is an edit and no-ops at this seam.
	const gatedSearchReplace: typeof searchReplace = {
		replaceOne: (match, template) =>
			canReplace ? searchReplace.replaceOne(match, template) : Promise.resolve(0),
		replaceAll: (matches, template) =>
			canReplace ? searchReplace.replaceAll(matches, template) : Promise.resolve(0)
	};
	const searchState = createSearchState({
		getDoc,
		getDocumentGeneration: () => documentGeneration,
		decorations,
		replace: gatedSearchReplace,
		// Rides the one public seam, which also owns the reveal anchor (top-pinned by
		// default, which is what search wants), so the band's async image-decode churn
		// can't clamp the reveal off the match.
		reveal: (p) => rects.scrollTo(p),
		onClose: caretRestore.restore
	});
	// Lives here, not in SearchBar, so the root Ctrl+H and the bar's chevron share one
	// source of truth.
	let replaceExpanded = $state(false);

	const announceReorder = async (message: string) => {
		// Clear first: Svelte skips the DOM write on a ===-equal assignment, which drops
		// the second of two identical announcements.
		reorderAnnouncement = '';
		await tick();
		reorderAnnouncement = message;
	};
	const reorder = createReorderAction(editorActionsDeps, controller, (to, total) => {
		announceReorder(movedBlockToPosition(to + 1, total));
	});

	// ── Context provision ───────────────────────────────────────────────

	// The action bundles stay per-key so a container re-provides exactly what it
	// overrides; HISTORY is G1.4's single-provider subject. The rest rides three facets.
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
		edgeAffinity,
		pendingMarks,
		revealAnchor,
		widgetSelection,
		controller,
		pasteCoordinator,
		reorder,
		reorderAnnounce: announceReorder,
		registryView,
		rects
	} satisfies EditorServices);

	setContext(EDITOR_POLICIES_KEY, {
		resolveImageUrl: resolveImageUrlImpl,
		resolveLinkUrl: resolveLinkUrlImpl,
		imageLoadPolicy: () => imageLoadPolicy,
		// Reading mode forces the handle off through the prop's own funnel; both render
		// sites read this one getter.
		blockDragHandles: () => blockDragHandles && effectiveMode !== 'reading',
		presentationMode: () => effectiveMode,
		theme: () => theme,
		keybindingOverrides: () => overridesMap,
		// An accessor, not the `onPasteImage,` shorthand: the shorthand captures the prop
		// and svelte-check reports `state_referenced_locally`, which
		// `svelte/no-unused-svelte-ignore` won't let us suppress.
		get onPasteImage() {
			return onPasteImage;
		},
		brokenImageUrls
	} satisfies EditorPolicies);

	// ── Root DOM effects ────────────────────────────────────────────────

	// Mode flips are blur-class events: a live reveal or composition must fold through
	// the existing blur choke points before the surface goes inert, so blur the active
	// element rather than invent a new fold path.
	// svelte-ignore state_referenced_locally
	let lastEffectiveMode = effectiveMode;
	$effect(() => {
		const mode = effectiveMode;
		if (mode === lastEffectiveMode) return;
		lastEffectiveMode = mode;
		// Which markers paint just changed, so a side recorded against the old geometry
		// no longer names the offset the user meant.
		edgeAffinity.reset();
		if (mode === 'reading') {
			// The gap is an editor-owned caret no DOM blur can reach, so it folds here beside
			// the blur rather than at each arrival path (#88).
			selectionState.clearGapCaret();
			// Header chrome keeps its focus, or a mode toggle blurs a title field mid-edit.
			const active = document.activeElement;
			if (active instanceof HTMLElement && editorEl?.contains(active) && !isHostChrome(active))
				active.blur();
		}
		events.emit('presentationModeChange', mode);
	});

	// A theme flip invalidates no live edit, so it only has to be announced — for
	// plugins that paint their own colors and can't see the flip through CSS.
	// svelte-ignore state_referenced_locally
	let lastTheme = theme;
	$effect(() => {
		const next = theme;
		if (next === lastTheme) return;
		lastTheme = next;
		events.emit('themeChange', next);
	});

	// CSS keys on `data-cross-block` to hide the native caret and selection highlight
	// while the overlay paints the cross-block range.
	$effect(() => {
		if (!editorEl) return;
		if (selectionState.isCrossBlock) {
			editorEl.setAttribute('data-cross-block', '');
		} else {
			editorEl.removeAttribute('data-cross-block');
		}
	});

	// Only Ctrl/Cmd+click activates a link, so CSS switches links to a pointer cursor
	// off `data-mod-active`. Reset on blur and visibility loss, or a modifier released
	// while the page is unfocused sticks the cursor on.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		// Track the last reflected state so ordinary typing never touches the DOM,
		// keeping the attribute write off the keystroke hot path (perf:check).
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
		return removeAll(
			onRoot(document, 'keydown', onKey),
			onRoot(document, 'keyup', onKey),
			onRoot(window, 'blur', reset),
			onRoot(document, 'visibilitychange', onVisibility)
		);
	});

	// A delegated handle-drag on the root, torn down on unmount via the lifetime signal.
	$effect(() => {
		if (!editorEl) return;
		const handle = installReorderDrag({
			editorRoot: editorEl,
			getScrollHost,
			moveReorderUnit: reorder.moveReorderUnit,
			overlay: {
				setGhost: (g) => (reorderGhost = g),
				setLine: (l) => (reorderLine = l)
			},
			lifetimeSignal: lifetimeController.signal
		});
		return () => handle.dispose();
	});

	// Single-block caret motion never goes through SelectionState, so without this
	// bridge subscribers miss every intra-block move. Scoped to this root to avoid
	// noise from selections elsewhere on the page.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const handler = () => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return;
			const anchorNode = sel.anchorNode;
			if (!anchorNode || !root.contains(anchorNode)) return;
			// A selection in host chrome is not a document selection: emitting there
			// reports this editor's own unchanged selection on every header caret move.
			if (isHostChrome(anchorNode)) return;
			events.emit('selectionChange', getSelection());
		};
		return onRoot(document, 'selectionchange', handler);
	});

	// ── Editor-root keydown routing ──────────────────────────────────────
	//
	// When the caret's block windows out, focus drops to <body> and the per-block
	// keydown handlers go silent, so this editor-scope handler reuses the same
	// cross-block composer with the root and the focus path standing in for `getEl`
	// (a mount guard) and `getMyPath` (a fallback).
	const editorCrossBlock = createCrossBlockHandlers({
		getEl: () => editorEl ?? null,
		getMyPath: () => selectionState.focus?.path ?? [],
		getIndex: () => selectionState.focus?.path?.[0] ?? 0,
		selection: selectionState,
		getDoc,
		getBlockElByPath,
		revealPath,
		getEditorRoot: () => editorEl ?? null,
		getScrollHost,
		getEditorLifetime: () => lifetimeController.signal,
		stickyColumn,
		edgeAffinity,
		blockEdit,
		controller,
		history,
		pluginEditor: pluginEditorLookup,
		getPresentationMode: () => effectiveMode,
		linkRef: linkRefView,
		onCommandError: commandErrorSink,
		pasteCoordinator,
		getKeybindingOverrides: () => overridesMap,
		grammar: registryView.grammar,
		events,
		getCursorOffset: () => selectionState.focus?.offset ?? null,
		afterReactivity: () => tick()
	});

	// Document-level chords for the windowed-out caret, plus the search shortcuts. Every
	// arm is contained to THIS instance: the listener sees every editor's keystrokes on
	// the page, so an unguarded handler let one Ctrl+Z revert two editors.
	const rootKeydown = createEditorRootKeydown({
		get searchBarEnabled() {
			return searchBar;
		},
		get mode() {
			return effectiveMode;
		},
		get canReplace() {
			return canReplace;
		},
		get keybindingOverrides() {
			return overridesMap;
		},
		get isCrossBlock() {
			return selectionState.isCrossBlock;
		},
		search: searchState,
		history,
		pluginEditor: pluginEditorLookup,
		onCommandError: commandErrorSink,
		crossBlock: editorCrossBlock,
		isHostChrome,
		saveSearchRange: caretRestore.save,
		setReplaceExpanded: (expanded) => (replaceExpanded = expanded)
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		return onRoot(root.ownerDocument, 'keydown', (e: KeyboardEvent) =>
			rootKeydown.handleKeyDown(e, root)
		);
	});

	// ── Editor-root clipboard routing ────────────────────────────────────
	//
	// The keydown sibling's counterpart: a Ctrl+C/X/V that Chromium retargeted to <body>
	// because the selection found no text position to park a caret in — a cross-block
	// endpoint, or a selected inline widget. Same containment — the arms claim only
	// events landing on THIS root, or on the body with this instance holding the
	// body-chord claim.
	const rootClipboard = createEditorRootClipboard({
		selection: selectionState,
		getDoc,
		crossBlock: editorCrossBlock,
		// A live policy value, like the accessor the blocks' policies context hands out.
		get onPasteImage() {
			return onPasteImage;
		},
		events,
		getSelectedWidgetBlock: () => {
			const selected = widgetSelection.getSelected();
			return selected ? getBlockComponent(selected.paragraphPath) : null;
		}
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		const doc = root.ownerDocument;
		return removeAll(
			onRoot(doc, 'copy', (e: ClipboardEvent) => rootClipboard.handleCopy(e, root)),
			onRoot(doc, 'cut', (e: ClipboardEvent) => rootClipboard.handleCut(e, root)),
			onRoot(doc, 'paste', (e: ClipboardEvent) => rootClipboard.handlePaste(e, root))
		);
	});

	// ── Virtual rendering (top-level windowing) ──────────────────────────

	// How far the host scaled the type off the size HEIGHT_ESTIMATES were calibrated
	// at. Plain `let`, not `$state`: the oracle reads it inside `estimate()`, the
	// feature's hottest path, and `widthVersion` is already the rebuild signal.
	let typeScale = 1;

	// Only the font-relative terms scale: block chrome is absolute padding and an
	// image's height is its own. Getters, so a scale change lands without rebuilding
	// the oracle or dropping its measured heights.
	const heightOracle = createHeightOracle({
		get lineHeight() {
			return HEIGHT_ESTIMATES.proseLineHeight * typeScale;
		},
		get codeLineHeight() {
			return HEIGHT_ESTIMATES.codeLineHeight * typeScale;
		},
		get avgCharWidth() {
			return HEIGHT_ESTIMATES.avgCharWidth * typeScale;
		},
		blockChrome: HEIGHT_ESTIMATES.blockChrome,
		imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
	});

	// A WIDTH change re-wraps prose, staling every cached height, so the scopes rebuild
	// off this counter; a height-only resize is ignored. ResizeObserver's per-callback
	// batching is the coalescing — no setTimeout/rAF debounce (G4.4).
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

	// The width change's sibling: a font-size move puts estimates off several-fold, so a
	// document whose true height clears the activation watermark can fail to window at
	// all. Only the off-window set depends on the ESTIMATE moving. The width observer
	// can't see this (no other box in the root resizes), hence the `1em` probe.
	function applyTypeScale(fontSizePx: number): void {
		const next = fontSizePx / ESTIMATE_BASE_FONT_SIZE;
		// Sub-percent moves are sub-pixel on a line box — not worth a full rebuild.
		if (!(next > 0) || Math.abs(next - typeScale) < 0.01) return;
		typeScale = next;
		heightOracle.invalidateWidth();
		widthVersion++;
	}
	$effect(() => {
		const el = typeScaleProbeEl;
		if (!el) return;
		applyTypeScale(el.getBoundingClientRect().height);
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.borderBoxSize?.[0];
			applyTypeScale(box ? box.blockSize : el.getBoundingClientRect().height);
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	// The header slot's height lives outside the height model and `overflow-anchor` is
	// off (VR-2), so a growing header would slide the document under the reader.
	// Compensate from the SLOT's own resize, never a scroll or model change, so this
	// composes with `correctAnchor` instead of double-correcting; a reveal already
	// holding the scroll outranks it and is asked, not re-placed.
	$effect(() => {
		const el = headerEl;
		const scrollEl = editorEl;
		if (hostScroll || !el || !scrollEl) return;
		let lastHeight = el.getBoundingClientRect().height;
		const observer = new ResizeObserver((entries) => {
			// Border boxes throughout, seed and fallback alike, so a browser without
			// `borderBoxSize` computes the same delta.
			const box = entries[0]?.borderBoxSize?.[0];
			const height = box ? box.blockSize : el.getBoundingClientRect().height;
			const delta = height - lastHeight;
			lastHeight = height;
			if (delta === 0 || scrollEl.scrollTop === 0) return;
			if (!topWindowing.revealHoldsScroll()) scrollEl.scrollTop += delta;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	// Drives each windowing scope's per-level pin, so a scroll that pushes the caret
	// off-screen never tears down native focus/IME. Plain `let`, not $state: focusout
	// fires mid-teardown during a structural commit, where a reactive write would trip
	// state_unsafe_mutation.
	let focusedPath: number[] | null = null;

	// Marks the block host whose leaf holds the caret; both preview modes' CSS key their
	// focused-block reveal off it. Imperative for focusedPath's teardown-safety reason,
	// and mode-gated so source/reading DOM stays byte-identical.
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
	// Entering a preview mode marks the already-focused block, since no re-focus fires.
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
			const path = readBlockPath(host);
			focusedPath = path && path.length > 0 ? path : null;
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks — keep the pin
			focusedPath = null;
			setFocusedHost(null);
		};
		return removeAll(onRoot(root, 'focusin', onFocusIn), onRoot(root, 'focusout', onFocusOut));
	});
	// Assembled here, after the windowing signals it carries exist; the block
	// components and the windowing hook below both read it back through getContext.
	setContext(EDITOR_DOC_KEY, {
		doc: getDoc,
		contentVersion,
		linkRef: linkRefView,
		pluginEditor: pluginEditorLookup,
		lifetime: lifetimeController.signal,
		editorRoot: () => editorEl ?? null,
		scrollHost: getScrollHost,
		blockElLookup: getBlockElByPath,
		focusedPath: () => focusedPath,
		heightOracle,
		windowingEnabled: () => !hostScroll,
		widthVersion: () => widthVersion
	} satisfies EditorDoc);

	// getListEl is the inner .block-list wrapper, never editorEl (== scrollEl): it
	// scrolls with content, so its top maps root scrollTop into local coordinates,
	// where editorEl would collapse to 0.
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
	 * A frozen snapshot of the current selection, or null when nothing is focused.
	 * Path arrays are copies, so mutating the result does not affect internal state.
	 */
	export function getSelection(): EditorSelection | null {
		return readCurrentSelection(selectionState, blockRefs);
	}

	/**
	 * The one restore road: resolve + clamp, reveal through the SCROLLING primitive,
	 * place — the mount primitive can't promise a focus block IN VIEW, since overscan
	 * keeps blocks mounted past the fold. `hold` decides whether the reveal's pin
	 * outlives the call: a navigation holds, a consumer restore hands the viewport back
	 * so a kept pin can't override the scroll the host writes next.
	 */
	function restoreThroughRevealRoad(
		selection: EditorSelection,
		hold: boolean
	): Promise<SelectionRestoreOutcome> {
		return restoreSelection(selection, {
			getDoc,
			selectionState,
			getBlockElByPath,
			revealTarget: (path) => rects.scrollTo(path, { block: 'nearest', hold })
		});
	}

	function caretAt(path: number[]): EditorSelection {
		return { anchor: { path, offset: 0 }, focus: { path, offset: 0 } };
	}

	/**
	 * Restore a snapshot from {@link getSelection}, sharing the whole restore road with
	 * the undo swap and plugin navigation so the three cannot diverge. True iff the
	 * selection was placed AND its focus block is in view; a later programmatic reveal
	 * mid-settle owns the viewport and makes this false, a user gesture does not.
	 */
	export async function setSelection(selection: EditorSelection): Promise<boolean> {
		return (await restoreThroughRevealRoad(selection, false)) === 'applied';
	}

	// The dead-space click's own landing walk, minus the press/target discrimination a host
	// caller has already done for itself. See `editor-props.ts` for the contract.
	export function placeCaretAtPoint(x: number, y: number): boolean {
		return editorEl ? deadSpaceCaret.placeAtPoint(editorEl, x, y) : false;
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

	// Recomposed per call rather than derived: the kind and plugin registries are
	// process-global and mutate outside this component's reactive graph.
	export function reservedChords(): ReadonlySet<string> {
		return collectReservedChords({ searchBar, keybindings: overridesMap });
	}

	export function claimsChord(event: KeyboardEvent): boolean {
		return chordIsClaimed(event, reservedChords());
	}

	// Reads the public snapshot, so it covers single-block carets the cross-block
	// SelectionState never holds.
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
		setSelection,
		placeCaretAtPoint,
		getEvents,
		getSearch,
		getDecorations,
		getRects,
		getDiagnostics,
		reservedChords,
		claimsChord
	} satisfies EditorInstance);

	// ── Test-only surface ───────────────────────────────────────────────

	function getOperationsLog() {
		return operationsLog;
	}

	function getUndoStack() {
		return undoManager.getStacks();
	}

	/** The live CST Document; treat it as read-only, since mutating it bypasses the
	 *  undo pipeline. */
	function getDocument() {
		return doc;
	}

	export const __test = {
		getDocument,
		getBlockComponent,
		getUndoStack,
		getOperationsLog,
		// Specs need the state, not the `data-cross-block` mirror: a deferred $effect
		// writes the attribute, and an intra-table rectangle keeps one path on both
		// endpoints, so neither the DOM nor getSelection() answers this reliably.
		isCrossBlockActive: () => selectionState.isCrossBlock,
		// The gap caret has no public selection shape and no paint yet, so the state is the
		// only place arrival can be observed.
		getGapCaret: () => selectionState.gapCaret,
		// The engine, not the `addSource`-only public registry: the derived per-path
		// buckets are the only oracle for a stale bucket, since jsdom measures every
		// range at zero width and no overlay ever paints there.
		getDecorationEngine: () => decorationEngine,
		// Constructs the stale-slot artifact the windowed each-block's cleanup can
		// leave behind (see revealPath's isStale wiring); e2e-only.
		setBlockRefSlot: blockRefSlots.set
	};
</script>

<!-- tabindex="-1": focusable so a windowed-out block hands focus here rather than to
	<body>, but not tab-reachable. Non-editable, so focusing it creates no native
	selection for the selectionchange bridge to collapse. -->
<!-- data-presentation is ABSENT in source mode on purpose: the default path's DOM
	stays byte-identical, and reading-mode CSS keys on the attribute's presence. -->
<div
	class="editor"
	data-editor-theme={theme}
	data-scroll-mode={hostScroll ? 'host' : undefined}
	data-presentation={effectiveMode === 'source' ? undefined : effectiveMode}
	bind:this={editorEl}
	tabindex="-1"
	role="group"
	aria-label={EDITOR_LABEL}
>
	{#if searchBar}
		<!-- Zero-height sticky anchor, so the bar doesn't scroll away with content. Portaled
		     out, it drops that positioning (the consumer's element is the box) and carries the
		     theme scope, since custom properties resolve by DOM ancestry. -->
		<div
			class:search-anchor={!searchBarAnchor}
			class:aragonite-editor-theme={!!searchBarAnchor}
			data-editor-theme={searchBarAnchor ? theme : undefined}
			{@attach portalInto(searchBarAnchor)}
		>
			<SearchBar
				replaceExpanded={replaceExpanded && canReplace}
				onToggleReplace={() => (replaceExpanded = canReplace && !replaceExpanded)}
			/>
		</div>
	{/if}
	<!-- One `em` tall and out of flow: its box IS the root's computed font size, which
	     no other box reports, and windowing's activation decision needs that scale. -->
	<div class="type-scale-probe" bind:this={typeScaleProbeEl} aria-hidden="true"></div>
	{#if header}
		<!-- A SIBLING of the block list, never a wrapper: the windowing scope resolves
		     its list as a direct child of this root. -->
		<div class="editor-header" bind:this={headerEl}>{@render header()}</div>
	{/if}
	<BlockList
		children={doc.children}
		{blockIds}
		slots={blockRefSlots}
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
	<LinkCardHost
		card={linkCard}
		{controller}
		{events}
		{getDoc}
		getEditorEl={() => editorEl ?? null}
		measureRange={rects.rangeRects}
		landCaret={rects.navigateTo}
		{activateLink}
		{caretRestore}
		linkRef={linkRefView}
		grammar={registryView.grammar}
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
		/* The type-scale root: every construct sizes in `em` off this, so one
		   declaration scales the whole surface. */
		font-size: var(--editor-font-size, 1rem);
		line-height: 1.6;
		color: var(--color-text-primary, #ffffff);
		min-height: 200px;
		overflow-y: auto;
		/* The editor corrects the scroll anchor by hand (list-windowing's
		   correctAnchor); native anchoring independently rewrites scrollTop and
		   double-corrects. Do NOT restore `overflow-anchor` (VR-2). */
		overflow-anchor: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #a4a4a4) transparent;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		/* Containing block for the image overlay portal. */
		position: relative;
	}

	/* Embedded flow mode: an ancestor owns the scroll, so the root drops its scrollport
	   and the standalone-widget chrome that would box every entry of a journal. Native
	   anchoring returns with the scrollport — the VR-2 opt-out exists for hand-corrected
	   windowing, which never activates here, and `none` would exclude the subtree from
	   the HOST's anchor candidates entirely. */
	.editor[data-scroll-mode='host'] {
		overflow-y: visible;
		overflow-anchor: auto;
		min-height: 0;
		flex: none;
		border: none;
		padding: 0;
	}

	/* Absolute and zero-width so it takes no part in layout; never `display: none`,
	   which stops a ResizeObserver reporting. */
	.type-scale-probe {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 1em;
		visibility: hidden;
		pointer-events: none;
	}

	/* Sticks to the scrollport top reserving no space; the bar positions absolutely
	   against it and stays put as the editor scrolls. */
	.search-anchor {
		position: sticky;
		top: 0;
		height: 0;
		z-index: 5;
	}

	/* Sticky resolves against the nearest SCROLLPORT, which in flow mode is the host's,
	   floating the bar over unrelated page content; absolute re-homes it to the root. */
	.editor[data-scroll-mode='host'] .search-anchor {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
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

	/* A nested drag reorders only within its container, so the container takes a faint
	   transient wash — deliberately not an outline (a document should feel like a
	   document, not a pile of blocks). Applied by editor-actions/reorder-drag.ts. */
	:global(.reorder-scope) {
		background: var(--reorder-scope-bg, rgba(100, 150, 255, 0.14));
		border-radius: 4px;
		transition: background-color 0.12s ease;
	}

	/* Viewport-fixed, since the rects come from client coords; pointer-events:none so
	   they never intercept the drag's own pointer stream. */
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
