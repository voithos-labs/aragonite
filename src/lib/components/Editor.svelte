<script lang="ts">
	import { setContext, tick, onMount, untrack } from 'svelte';
	import '../styles/editor.css';
	import type { BlockComponent } from '../block-component';
	import type { AnyBlockKind, Document } from '../core/nodes';
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
	import { createScrollport, type Scrollport } from '../cursor/scrollport';
	import { createDeadSpaceCaret } from '../selection/dead-space-caret';
	import { resetForPointerDown } from '../selection/cross-block/pointer';
	import { createContentVersion } from '../reactivity/content-version.svelte';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { refSlotsOver, replaceRefs, revealChildOrWait } from '../reactivity/publish-ref.svelte';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { createSelectionDescription } from '../selection/selection-description';
	import { EDITOR_LABEL, movedBlockToPosition } from '../a11y-strings';
	import type { EditorSelection } from '../selection/primitives';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../block-id';
	import { ensureEditableContainers, emptyParagraph } from '../tree-operations';
	import { blockNodeAt, isBlockNode, nodeAt } from '../tree-operations/node-ops';
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
	import { createEditorEvents, emitBlockedLinkError, emitCommandError } from '../editor-events';
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
	import { findSurfacePathForElement, readBlockPath } from '../selection/path-lookup';
	import { createCaretRestore } from '../selection/caret-restore';
	import { createCrossBlockHandlers } from '../selection/cross-block/dispatch';
	import { isPreviewMode } from '../presentation-mode';
	import { normalizeKeybindingOverrides } from '../schema/keybinding-overrides';
	import { createEditorRootKeydown } from './editor-root-keydown';
	import { createEditorRootClipboard } from './editor-root-clipboard';
	import {
		installModActiveTracker,
		installSelectionChangeBridge,
		installViewportHeightWatcher,
		onRoot,
		removeAll
	} from './editor-root-listeners';
	import { collectReservedChords, chordIsClaimed } from '../schema/reserved-chords';
	import { portalInto } from './portal';
	import {
		registerEditor,
		unregisterEditor,
		markEditorInteracted,
		releaseInteractedEditor,
		isTextEntrySurface
	} from '../active-editor';
	import { ambientLengthOf } from '../ambient/ambient-dom';
	import { toClampedRawOffset } from '../cursor/coordinate-spaces';
	import { domTextOffsetAtNode } from '../cursor/widget-offset';
	import {
		canRunCommandById,
		runCommandById,
		type CommandDispatchContext,
		type CommandErrorSink,
		type KindCommandTarget
	} from '../schema/block-commands';
	import type { AnyCommandId } from '../schema/command-id';
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
	import { assertInvariant } from '../assert';
	import { checkMarkerCssParity } from '../invariants/marker-css-parity';
	import { checkLandableCaret } from '../invariants/landable-caret';
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

	// The scrollport every windowing scope measures and writes, over the SAME scroller the
	// autoscroll seam resolves — so the mode picks the target and nothing downstream branches
	// on it. Memoized with that resolution.
	let scrollport: Scrollport | null = null;
	function getScrollport(): Scrollport | null {
		if (!scrollport) {
			const target = getScrollHost();
			if (target) scrollport = createScrollport(target);
		}
		return scrollport;
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
		onLinkActivate
			? onLinkActivate(url, event)
			: defaultLinkActivation(url, event, (blocked) => emitBlockedLinkError(events, blocked));

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
	// The edit epoch's twin at render cadence: a byte-writing door bumps it immediately,
	// while `editEpoch` waits for the typing batch to flush. Inline widgets derive at
	// render cadence and need this one.
	const contentVersion = createContentVersion();
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
	// Plain, not `$state`: the top-level scope's slot storage (see `refSlotsOver`).
	const blockRefs: (BlockComponent | undefined)[] = [];
	const blockRefSlots = refSlotsOver(blockRefs);
	let editorEl: HTMLDivElement | undefined = $state();
	// Inside a themed host the editor sits under no opt-in class, and the portaled search
	// bar must not carry one either: the class's defaults would shadow the host tokens the
	// anchor already inherits.
	const inThemedScope = $derived(!!editorEl?.closest('.aragonite-editor-theme'));
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
			// Announced like the `source` swap: dropping the native range ends the document
			// caret without moving a field the clear guards on, and the native `selectionchange`
			// it fires bails on the empty range before it reaches the channel.
			selectionState.batch(() => {
				selectionState.clear();
				selectionState.announceSelection();
			});
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
			// try/finally: the log/LRD half and the notify were separate listeners once,
			// so a throwing first half must still reach the notify (and the error event).
			try {
				operationsLog.record({
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
			} finally {
				notifyDocumentChanged();
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
			contentVersion.bump();
			blockIds = assignIds(doc.children);
			blockRefs.length = 0;
			undoManager.clear();
			stickyColumn.reset();
			edgeAffinity.reset();
			// Announced, not left to the clear: the swap usually arrives on a plain caret, which
			// is native-only, so nothing editor-owned moves and subscribers would keep painting
			// the outgoing document's selection. Batched, so a real range still emits once.
			selectionState.batch(() => {
				selectionState.clear();
				selectionState.announceSelection();
			});
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

	/**
	 * The host's own chrome, mounted inside this root. Every rule meaning "this is the
	 * editor's own CONTENT" asks here rather than carrying its own `contains` copy,
	 * which is how one gets missed. The focusout guards keep using `contains` — for
	 * "did focus leave the whole widget", the slot IS part of the editor.
	 */
	function isHostChrome(node: Node | null): boolean {
		return !!node && !!headerEl && headerEl.contains(node);
	}

	// ── Dead-space caret ────────────────────────────────────────────────

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
		},
		lastBlockIndex: () => doc.children.length - 1,
		revealBlock: (index) => revealPath([index])
	});

	// ── Link card door ──────────────────────────────────────────────────

	// The caret snapshot and the entry guards ride the STATE, not the callers, so entry path N+1
	// cannot forget them. Both doors decline a cross-block range absolutely: canOpen wants a
	// collapsed caret, canOpenCreate the live selection the create gesture wraps.
	const linkCard = createLinkCardState({
		onOpen: () => linkCardCaret.saveCurrent(),
		canOpen: () => !selectionState.isCrossBlock && window.getSelection()?.isCollapsed !== false,
		canOpenCreate: () =>
			!selectionState.isCrossBlock && window.getSelection()?.isCollapsed === false
	});

	/** Open the card on the link `el` renders, or report that nothing there is one. The caret has
	 *  already landed from mousedown, which is the one the state snapshots. */
	function openLinkCard(el: Element): boolean {
		const path = findSurfacePathForElement(el);
		if (!path) return false;
		const block = nodeAt(doc, path);
		if (block === null || !isBlockNode(block)) return false;
		const contentEl = getBlockElByPath(path);
		if (!contentEl) return false;
		const hit = resolveLinkAtPoint({ contentEl, block, path, linkRef: linkRefView });
		if (!hit) return false;
		return linkCard.open(hit.target);
	}

	// The card belongs to live mode alone; any other mode paints the destination bytes already.
	$effect(() => {
		if (effectiveMode !== 'live') linkCard.close();
	});

	// ── Hidden-run class probe ──────────────────────────────────────────

	// Once per mode change, the probe pays the getComputedStyle the per-keystroke hidden-run
	// predicate cannot afford, so the two class vocabularies cannot drift silently.
	$effect(() => {
		void effectiveMode;
		if (!editorEl) return;
		const root = editorEl;
		assertInvariant('marker-css-parity', () => checkMarkerCssParity(root));
	});

	// ── Root gesture listeners ──────────────────────────────────────────

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

	// Release on the next user-intent gesture, so the anchor holds only through the post-reveal
	// settle. NOT on `scroll`: a programmatic correctAnchor write fires `scroll` itself and
	// would self-release mid-settle. On the resolved PORT, not the root — the pin fights
	// whoever scrolls the port, and in host mode that gesture lands outside the editor.
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		const release = () => revealAnchor.releaseAll();
		return removeAll(
			onRoot(target, 'keydown', release),
			onRoot(target, 'pointerdown', release),
			onRoot(target, 'wheel', release, { passive: true })
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

	// ── Block element and component lookup ──────────────────────────────

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
		bumpContentVersion: contentVersion.bump,
		setBlockIds: (v) => {
			blockIds = v;
		},
		setBlockRefs: (v) => replaceRefs(blockRefs, v),
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
		landCaretAt: (path) => landCaretAtOffset(path, 0)
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

	// The document caret while chrome holds focus (selection/caret-restore.ts). One instance PER
	// consumer: a card opened over an open search bar would otherwise overwrite the pre-search
	// caret with its own, and closing the bar would land the user at the link.
	const searchCaret = createCaretRestore(() => editorEl ?? null);
	const linkCardCaret = createCaretRestore(() => editorEl ?? null);

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
		onClose: searchCaret.restore
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
		linkCard,
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

	/** The focused leaf's caret as (path, raw offset): the per-backend road while a leaf holds
	 *  focus, else the native range a toggle click leaves behind while chrome takes focus. */
	function captureFlipCaret(): { path: number[]; offset: number } | null {
		if (selectionState.isCrossBlock || selectionState.gapCaret) return null;
		const focused = readCurrentSelection(selectionState, blockRefs)?.focus;
		if (focused) return { path: focused.path, offset: focused.offset };
		const sel = window.getSelection();
		if (!sel?.focusNode || !editorEl?.contains(sel.focusNode) || isHostChrome(sel.focusNode))
			return null;
		const node = sel.focusNode;
		const el = node instanceof Element ? node : node.parentElement;
		const path = findSurfacePathForElement(el);
		if (!path) return null;
		const contentEl = getBlockElByPath(path);
		if (!contentEl?.contains(node)) return null;
		const offset = toClampedRawOffset(
			domTextOffsetAtNode(contentEl, node, sel.focusOffset),
			ambientLengthOf(contentEl)
		);
		return { path, offset };
	}

	// The flip's PRE phase, the last moment the outgoing mode owns the DOM: past it the mode's
	// render key has rebuilt every block from its own CST bytes, and the reveal's ephemeral edit
	// is gone. Reading keeps its entry snapshot — no caret of its own to recapture on the way out.
	let flipCaret: { path: number[]; offset: number } | null = null;
	// svelte-ignore state_referenced_locally
	let preFlipSeenMode = effectiveMode;
	$effect.pre(() => {
		const mode = effectiveMode;
		if (mode === preFlipSeenMode) return;
		const from = preFlipSeenMode;
		preFlipSeenMode = mode;
		untrack(() => {
			if (from !== 'reading') flipCaret = captureFlipCaret();
			// A flip is a blur-class event: a live reveal or composition folds through the existing
			// blur choke point. Host chrome is exempt, or a mode toggle blurs a title field mid-edit.
			const active = document.activeElement;
			if (active instanceof HTMLElement && editorEl?.contains(active) && !isHostChrome(active)) {
				active.blur();
				// A blur the editor performs announces the selection it drops: the document listener
				// only reports a range the browser still anchors in the root, and this one is gone.
				events.emit('selectionChange', getSelection());
			}
		});
	});

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
			// The gap is an editor-owned caret no DOM blur can reach, so the flip clears it
			// rather than each arrival path.
			selectionState.clearGapCaret();
		} else if (flipCaret) {
			const caret = flipCaret;
			flipCaret = null;
			void (async () => {
				// A post-tick focus like every structural op's; the road clamps the saved offset
				// into the destination mode's landable range at the door. Yielding to a focused
				// text-entry surface keeps the restore from stealing a host field mid-typing.
				// The reveal is the bare MOUNT: a flip is a view operation, so it re-seats the
				// caret without writing the scrollport the reader chose.
				await tick();
				if (effectiveMode !== mode || isTextEntrySurface(document.activeElement)) return;
				await restoreThroughRevealRoad(caretAt(caret.path, caret.offset), 'mount');
			})();
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
	// while the overlay paints the cross-block range. Keyed on the OVERLAY's own predicate:
	// a state it declines to paint must not also lose the caret, or the screen shows neither.
	$effect(() => {
		if (!editorEl) return;
		if (selectionState.isCustomRendered) {
			editorEl.setAttribute('data-cross-block', '');
		} else {
			editorEl.removeAttribute('data-cross-block');
		}
	});

	$effect(() => {
		if (!editorEl) return;
		return installModActiveTracker(editorEl);
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

	$effect(() => {
		if (!editorEl) return;
		return installSelectionChangeBridge({
			root: editorEl,
			isHostChrome,
			emit: () => events.emit('selectionChange', getSelection())
		});
	});

	// ── Editor-root keydown routing ──────────────────────────────────────
	//
	// When the caret's block windows out, focus drops to <body> and the per-block keydown handlers
	// go silent, so this editor-scope handler reuses the same cross-block composer with the root
	// and the focus path standing in for `getEl` and `getMyPath`.
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
		saveSearchRange: searchCaret.save,
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
	// The keydown sibling's counterpart: a Ctrl+C/X/V that Chromium retargeted to <body> because
	// the selection found no text position to park a caret in. Same containment — the arms claim
	// only events landing on THIS root, or on the body with this instance holding the chord claim.
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

	// ── Height oracle ───────────────────────────────────────────────────

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

	// ── Resize invalidation ─────────────────────────────────────────────

	// A WIDTH change re-wraps prose, staling every cached height, so the scopes rebuild
	// off this counter; a height-only resize spares the measured cache. ResizeObserver's
	// per-callback batching is the coalescing — no setTimeout/rAF debounce (G4.4).
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

	// The slice's own axis, watched on the RESOLVED port: the window's extent comes from the
	// scrollport's height, so a height-only resize otherwise leaves the newly-exposed band as
	// bare spacer until the next scroll. Its own counter, never `widthVersion` — that one
	// drops every measured height, which a resize re-wrapping no prose has not earned.
	let viewportHeightVersion = $state(0);
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		return installViewportHeightWatcher(target, () => viewportHeightVersion++);
	});

	// ── Type scale ──────────────────────────────────────────────────────

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

	// ── Header slot compensation ────────────────────────────────────────

	// The header slot's height lives outside the height model, so while the editor owns the
	// correction a growing header would slide the document under the reader. Compensating from
	// the SLOT's own resize is what composes with `correctAnchor` instead of double-correcting;
	// a reveal already holding the scroll outranks it.
	$effect(() => {
		const el = headerEl;
		if (!el || !editorEl) return;
		const port = getScrollport();
		if (!port) return;
		let lastHeight = el.getBoundingClientRect().height;
		const observer = new ResizeObserver((entries) => {
			// Border boxes throughout, seed and fallback alike, so a browser without
			// `borderBoxSize` computes the same delta.
			const box = entries[0]?.borderBoxSize?.[0];
			const height = box ? box.blockSize : el.getBoundingClientRect().height;
			const delta = height - lastHeight;
			lastHeight = height;
			if (delta === 0 || !ownsScrollCorrection() || port.scrollTop() === 0) return;
			if (!topWindowing.revealHoldsScroll()) port.setScrollTop(port.scrollTop() + delta);
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	// ── Focus attribution ───────────────────────────────────────────────

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
			// G1.33 at the seam every caret door crosses: a door seats a caret by focusing the
			// surface, whoever minted it, so a consumer's own door inherits the guard here.
			const landed = e.target;
			if (landed instanceof HTMLElement) {
				assertInvariant('landable-caret', () =>
					checkLandableCaret(landed, effectiveMode, path ?? [])
				);
			}
		};
		const onFocusOut = (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return; // moving between blocks — keep the pin
			focusedPath = null;
			setFocusedHost(null);
		};
		return removeAll(onRoot(root, 'focusin', onFocusIn), onRoot(root, 'focusout', onFocusOut));
	});
	// ── Top-level windowing ─────────────────────────────────────────────

	// Assembled here, after the windowing signals it carries exist; the block
	// components and the windowing hook below both read it back through getContext.
	setContext(EDITOR_DOC_KEY, {
		doc: getDoc,
		contentVersion: contentVersion.read,
		linkRef: linkRefView,
		pluginEditor: pluginEditorLookup,
		lifetime: lifetimeController.signal,
		editorRoot: () => editorEl ?? null,
		scrollHost: getScrollHost,
		scrollport: getScrollport,
		blockElLookup: getBlockElByPath,
		focusedPath: () => focusedPath,
		heightOracle,
		correctsScroll: ownsScrollCorrection,
		widthVersion: () => widthVersion,
		viewportHeightVersion: () => viewportHeightVersion
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

	// Plain `let`, not $state or $derived: the correction path asks this mid-measure, where
	// evaluating the window derived would force the layout read the batched pass exists to
	// avoid (VR-4). Nothing reactive reads it — the root's own attribute reads the derived,
	// so the flag lags the attribute one flush at a watermark crossing (measured harmless).
	let rootWindowingActive = false;
	$effect(() => {
		rootWindowingActive = topWindowing.window.active;
	});

	// Who holds the reader's place through a height mutation. Self mode always; host mode only
	// while windowing runs, since below the budget the host's own native anchoring does it and
	// both correcting would double-count. The `overflow-anchor` opt-out keys off the same fact.
	function ownsScrollCorrection(): boolean {
		return !hostScroll || rootWindowingActive;
	}

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serialize(doc);
	}

	// The kind alone, never the node: a host reads the tree's shape without holding a handle into
	// it. See `editor-props.ts` for the contract.
	export function getBlockKindAt(path: number[]): AnyBlockKind | null {
		return blockNodeAt(doc, path)?.kind ?? null;
	}

	/**
	 * A frozen snapshot of the current selection, or null when nothing is focused.
	 * Path arrays are copies, so mutating the result does not affect internal state.
	 */
	export function getSelection(): EditorSelection | null {
		return readCurrentSelection(selectionState, blockRefs);
	}

	/**
	 * The one restore road: resolve + clamp, reveal, place. `reveal` picks which reveal. The two
	 * scrolling ones differ in whether the pin outlives the call — a navigation holds, a consumer
	 * restore hands the viewport back so a kept pin can't override the host's next scroll — and
	 * `mount` is the history swap's bare mount, which promises no block IN VIEW (overscan keeps
	 * blocks mounted past the fold) and in exchange writes no scrollport.
	 */
	function restoreThroughRevealRoad(
		selection: EditorSelection,
		reveal: 'hold' | 'release' | 'mount'
	): Promise<SelectionRestoreOutcome> {
		return restoreSelection(selection, {
			getDoc,
			selectionState,
			getBlockElByPath,
			revealTarget: async (path) =>
				reveal === 'mount'
					? (await revealPath(path)) !== null
					: rects.scrollTo(path, { block: 'nearest', hold: reveal === 'hold' })
		});
	}

	function caretAt(path: number[], offset = 0): EditorSelection {
		return { anchor: { path, offset }, focus: { path, offset } };
	}

	/** Land the caret at a raw offset through the shared restore road — the link card's return
	 *  door after a commit, so the next keystroke (Ctrl+Z included) addresses the document. */
	async function landCaretAtOffset(path: number[], offset: number): Promise<boolean> {
		return (await restoreThroughRevealRoad(caretAt(path, offset), 'hold')) === 'applied';
	}

	/**
	 * Restore a snapshot from {@link getSelection}, sharing the whole restore road with
	 * the undo swap and plugin navigation so the three cannot diverge. True iff the
	 * selection was placed AND its focus block is in view; a later programmatic reveal
	 * mid-settle owns the viewport and makes this false, a user gesture does not.
	 */
	export async function setSelection(selection: EditorSelection): Promise<boolean> {
		return (await restoreThroughRevealRoad(selection, 'release')) === 'applied';
	}

	// The dead-space click's own landing walk, minus the press/target discrimination a host
	// caller has already done for itself. See `editor-props.ts` for the contract.
	export function placeCaretAtPoint(x: number, y: number): boolean {
		return editorEl ? deadSpaceCaret.placeAtPoint(editorEl, x, y) : false;
	}

	/**
	 * The block path behind `document.activeElement`, for the public doors that address the
	 * focused surface. A gap caret declines: its proxy is not a block, and a NESTED gap's proxy
	 * sits inside its container's host, which must not receive what was aimed at the gap.
	 */
	function focusedSurfacePath(): number[] | null {
		if (selectionState.gapCaret) return null;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !editorEl?.contains(active)) return null;
		return findSurfacePathForElement(active);
	}

	// Routed to the focused SURFACE, the way a paste event is: everything the pipeline owes
	// (transforms, delete-first, one undo entry, focus) lives below that seam, not here. See
	// `editor-props.ts` for the contract.
	export function insertMarkdown(md: string): boolean {
		const path = focusedSurfacePath();
		if (!path) return false;
		return getBlockComponent(path)?.insertMarkdown?.(md) ?? false;
	}

	const commandDispatchContext: CommandDispatchContext = {
		history,
		pluginEditor: pluginEditorLookup,
		getPresentationMode: () => effectiveMode,
		isCrossBlockRange: () => selectionState.isCrossBlock
	};

	// A gap caret focuses a proxy, not a block, so no block-local command has a surface to run
	// on; global ones still reach the seam, exactly as the gap caret's own chord proxy does.
	function focusedCommandTarget(): KindCommandTarget | null {
		const path = focusedSurfacePath();
		if (!path) return null;
		const component = getBlockComponent(path);
		const node = blockNodeAt(doc, path);
		if (!component?.runCommand || !node) return null;
		return { kind: node.kind, runCommand: (id, arg) => component.runCommand!(id, arg) };
	}

	// The door only resolves the focused surface; every rule (the reading gate, the cross-block
	// range decline, the arms themselves) lives below the seam. See `editor-props.ts`.
	export function runCommand(commandId: string): boolean {
		return runCommandById(
			commandId as AnyCommandId,
			undefined,
			focusedCommandTarget(),
			commandDispatchContext,
			commandErrorSink
		);
	}

	// The same seam the door dispatches through, so what a host greys out and what a click declines
	// cannot drift. See `editor-props.ts` for the contract.
	export function canRunCommand(commandId: string): boolean {
		return canRunCommandById(
			commandId as AnyCommandId,
			focusedCommandTarget(),
			commandDispatchContext
		);
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
		getBlockKindAt,
		getSelection,
		setSelection,
		placeCaretAtPoint,
		insertMarkdown,
		runCommand,
		canRunCommand,
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
		// The swap door's only oracle: every other door is reachable headlessly, but the
		// `source` prop's reset lives in this component.
		getContentVersion: contentVersion.read,
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
		// Constructs the detached-slot artifact the windowed each-block's cleanup can
		// leave behind (see `isSlotDetached`); e2e-only.
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
	data-windowing={topWindowing.window.active ? 'active' : undefined}
	data-presentation={effectiveMode === 'source' ? undefined : effectiveMode}
	bind:this={editorEl}
	tabindex="-1"
	role="group"
	aria-label={EDITOR_LABEL}
>
	{#if searchBar}
		<!-- Zero-height sticky anchor, so the bar doesn't scroll away with content. Portaled
		     out, it drops that positioning (the consumer's element is the box) and carries the
		     editor's own theme scope, since custom properties resolve by DOM ancestry. -->
		<div
			class:search-anchor={!searchBarAnchor}
			class:aragonite-editor-theme={!!searchBarAnchor && inThemedScope}
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
		grammar={registryView.grammar}
		lifetime={lifetimeController.signal}
	/>
	<LinkCardHost
		card={linkCard}
		{controller}
		{events}
		{getDoc}
		getEditorEl={() => editorEl ?? null}
		measureRange={rects.rangeRects}
		landCaret={landCaretAtOffset}
		{activateLink}
		resolveLinkUrl={resolveLinkUrlImpl}
		caretRestore={linkCardCaret}
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

	/* Embedded flow mode: an ancestor owns the scroll, so the root drops its scrollport and the
	   standalone-widget chrome that would box every entry of a journal. Below the windowing
	   budget nothing corrects by hand, so native anchoring is restored — `none` would strip the
	   subtree from the HOST's anchor candidates and hold nothing in its place. */
	.editor[data-scroll-mode='host'] {
		overflow-y: visible;
		overflow-anchor: auto;
		min-height: 0;
		flex: none;
		border: none;
		padding: 0;
	}

	/* The stated trade of windowing under host scroll: native anchoring and the manual
	   correction cannot coexist, so an active editor withdraws its own subtree from the host's
	   anchor candidates and holds the line itself (VR-2). The host's scroller is untouched. */
	.editor[data-scroll-mode='host'][data-windowing='active'] {
		overflow-anchor: none;
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
