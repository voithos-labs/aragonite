<script lang="ts">
	import { setContext, tick, onMount, untrack } from 'svelte';
	import '../styles/editor.css';
	import type { BlockComponent } from '../block-component';
	import type { AnyBlockKind, Document } from '../core/nodes';
	import type {
		EditorProps,
		EditorInstance,
		EditorDiagnostics,
		InsertMarkdownOptions
	} from '../editor-props';
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
	import { createCaretMemory } from '../cursor/caret-memory';
	import { createAutoPairRecord } from './blocks/text/auto-pair-record';
	import { createRevealAnchorState } from '../cursor/reveal-anchor';
	import { createHeightOracle } from '../cursor/height-oracle';
	import { HEIGHT_ESTIMATES } from '../cursor/typography-estimates';
	import { createScrollHostResolution } from './editor-root-scroll-host';
	import { installSelectionDrop, type DropCaretRect } from '../selection/selection-drop';
	import { createContentVersion } from '../reactivity/content-version.svelte';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { refSlotsOver, replaceRefs, revealChildOrWait } from '../reactivity/publish-ref.svelte';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { createSelectionDescription } from '../selection/selection-description';
	import { EDITOR_LABEL, movedBlockToPosition } from '../a11y-strings';
	import TailInsert from './TailInsert.svelte';
	import BlockMenu from './menu/BlockMenu.svelte';
	import { createMenuPresence } from './menu/menu-presence.svelte';
	import { registerDefaultContextActions } from './menu/default-context-actions';
	import type { EditorSelection } from '../selection/primitives';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { imageAtTarget } from './image/image-edit-commit';
	import type { SelectedWidgetHandle } from '../selection/primitives';
	import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';
	import { assignIds } from '../block-id';
	import { createDocumentSwap, initDocument } from './editor-root-document-swap';
	import { blockNodeAt } from '../tree-operations/node-primitives';
	import { inlineReaderFor } from '../core/inline';
	import { serialize } from '../core/serializer';
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
	import { createEditorDiagnostics } from '../debug/editor-diagnostics';
	import { readCurrentSelection } from '../selection/native-bridge';
	import { restoreSelection, type SelectionRestoreOutcome } from '../selection/selection-restore';
	import { createCaretRestore } from '../selection/caret-restore';
	import { createCrossBlockHandlers } from '../selection/cross-block/dispatch';
	import { createCrossBlockCommands } from '../selection/cross-block/format-toggle';
	import { normalizeKeybindingOverrides } from '../schema/keybinding-overrides';
	import { createEditorRootKeydown } from './editor-root-keydown';
	import { BARE_MODIFIER_KEYS } from '../schema/keybindings';
	import { createEditorRootClipboard } from './editor-root-clipboard';
	import { createModeFlip } from './editor-root-mode-flip';
	import { createFocusAttribution } from './editor-root-focus';
	import { createRootGestures } from './editor-root-gestures';
	import { createRootMenus, type BlockMenuModel } from './editor-root-menus';
	import { createFocusedSurface } from './editor-root-focused-surface';
	import type { EditorTestSurface } from './editor-root-test-surface';
	import {
		installHeaderSlotCompensation,
		installTypeScaleProbe,
		installViewportHeightWatcher,
		installWidthWatcher
	} from './editor-root-geometry';
	import { createSelectionAnnouncer } from '../selection/selection-announcer';
	import { createKindCue } from './kind-cue.svelte';
	import {
		installEditorBlurAnnouncer,
		installModActiveTracker,
		installRevealAnchorRelease,
		installSelectionChangeBridge,
		onRoot,
		removeAll
	} from './editor-root-listeners';
	import { collectReservedChords, chordIsClaimed } from '../schema/reserved-chords';
	import { portalInto } from './portal';
	import {
		registerEditor,
		unregisterEditor,
		markEditorInteracted,
		releaseInteractedEditor
	} from '../active-editor';
	import {
		canRunCommandById,
		isCommandActiveById,
		runCommandById,
		type CommandDispatchContext,
		type CommandErrorSink
	} from '../schema/block-commands';
	import type { AnyCommandId } from '../schema/command-id';
	import { installPlugins, normalizePluginEntries } from '../schema/plugin-install';
	import { activationFor, everyInstalledPlugin } from '../schema/plugin-activation';
	import { createEditorPluginContexts, mintEditorId } from '../schema/plugin-editor-context';
	import { insertCatalogue, type InsertEntry } from '../schema/insert-catalogue';
	import { createRegistryView, type KindEnablement } from '../schema/registry-view';
	import type { Reading } from '../schema/reading';
	import { hidesDelimitersAtCaret } from '../presentation-mode';
	import BlockList from './BlockList.svelte';
	import SearchBar from './SearchBar.svelte';
	import SelectionToolbar from './menu/SelectionToolbar.svelte';
	import ImageOverlayHost from './image/ImageOverlayHost.svelte';
	import LinkCardHost from './link-card/LinkCardHost.svelte';
	import InlineMenuHost from './menu/InlineMenuHost.svelte';
	import { createInlineMenuState } from '../inline-menu/inline-menu-state.svelte';
	import type { InlineMenuRegistry } from '../inline-menu/types';
	import { createInlineRangeCommit } from '../editor-actions/inline-range-commit';
	import { createLinkCardState } from './link-card/link-card-state.svelte';
	import { runStartupInvariantChecks } from '../invariants/install';
	import { assertInvariant } from '../assert';
	import { checkMarkerCssParity } from '../invariants/marker-css-parity';
	import { registerBuiltInBlocks } from './built-in-blocks';
	import { blockContentElAt } from './block-el-lookup';

	registerBuiltInBlocks();
	bootstrapCodeLanguages();
	registerDefaultContextActions();
	runStartupInvariantChecks();

	// `__registryEnablement` is for tests only; the intersection type keeps it off the
	// public EditorProps.
	let {
		source = '',
		resolveImageUrl,
		resolveLinkUrl,
		imageLoadPolicy = 'auto',
		onLinkActivate,
		onPasteImage,
		onRunCode,
		codeMenuItems,
		header,
		blockDragHandles = true,
		searchBar = true,
		searchBarAnchor,
		selectionToolbar = true,
		keybindings,
		theme = 'dark',
		presentationMode = 'source',
		scrollMode = 'self',
		plugins,
		syntax,
		__registryEnablement
	}: EditorProps & { __registryEnablement?: KindEnablement } = $props();

	// Read once, not live: `scrollMode` is set once by contract, and reading it live inside
	// windowing's derived would make it a dependency of the hottest path.
	// svelte-ignore state_referenced_locally
	const hostScroll = scrollMode === 'host';

	const { getScrollHost, getClipBounds, getScrollport } = createScrollHostResolution({
		get editorEl() {
			return editorEl;
		},
		hostScroll
	});

	// Install before initDocument parses `source`, so plugin openers and directives are live
	// for the first parse. Set once by contract: a later prop change is ignored.
	// svelte-ignore state_referenced_locally
	const pluginEntries = plugins?.length ? normalizePluginEntries(plugins) : undefined;
	if (pluginEntries) installPlugins(pluginEntries.plugins);

	// The prop is the enablement set: this editor activates exactly what it listed. No prop
	// means no restriction, so everything installed in the process stays active here.
	const activePlugins = pluginEntries
		? activationFor(pluginEntries.plugins.map((p) => p.name))
		: everyInstalledPlugin;

	const overridesMap = $derived(normalizeKeybindingOverrides(keybindings));

	// The single mode reported everywhere (root attribute, context getter, plugin contexts,
	// events). It follows the requested mode only once the flip below has committed every edit
	// the outgoing mode was holding, so those writes land in the mode they were typed in.
	// svelte-ignore state_referenced_locally
	let effectiveMode = $state(presentationMode);
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

	// This editor's view of the global definitions, read by the first parse, every edit's reparse
	// and the inline scan. The test hook narrows the plugins prop.
	// svelte-ignore state_referenced_locally
	const registryView = createRegistryView({
		plugins: pluginEntries ? activePlugins : undefined,
		isEnabled: __registryEnablement,
		syntax
	});

	// doc/blockIds are mutable state structural ops write through directly, so they
	// cannot be $derived: snapshot at mount, re-sync via the $effect below.
	// svelte-ignore state_referenced_locally
	const initial = initDocument(source, registryView.grammar);
	let doc: Document = $state(initial.doc);
	// svelte-ignore state_referenced_locally
	let blockIds = $state<string[]>(assignIds(doc.children));
	// Bumped by every path that writes bytes. Inline widgets derive on it directly, and the
	// decoration engine's `editEpoch` follows it a tick later.
	const contentVersion = createContentVersion();
	let currentResolver = $state<LinkReferenceResolver>(initial.resolver);
	let currentSignature = $state<string>(initial.signature);
	// Reference-bearing render memos key on this instead of the whole (~MB) signature.
	let signatureEpoch = $state<number>(0);
	/** This editor's one reading context, shared by the block components (through context) and
	 *  the action bundles (through their deps), so a post-commit rebuild reaches both. */
	const reading: Reading = {
		grammar: registryView.grammar,
		get resolver(): LinkReferenceResolver {
			return currentResolver;
		},
		get resolverSignature(): string {
			return currentSignature;
		},
		get resolverEpoch(): number {
			return signatureEpoch;
		},
		mode: () => effectiveMode,
		hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(effectiveMode)
	};
	// Plain, not `$state`: where the root list's child refs are stored (see `refSlotsOver`).
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
	const caretMemory = createCaretMemory();
	const autoPairs = createAutoPairRecord();
	const revealAnchor = createRevealAnchorState();
	const operationsLog = createOperationsLog();
	const events = createEditorEvents();
	// getSelection is function-hoisted below, so every read here is a fresh snapshot.
	const selectionAnnouncer = createSelectionAnnouncer({
		read: () => getSelection(),
		emit: (selection) => events.emit('selectionChange', selection)
	});
	const selectionState = createSelectionState({
		onChange: ({ placementOnly }) => {
			// A range and a selected widget never coexist (widget-selection-state.svelte.ts).
			if (selectionState.isCrossBlock) widgetSelection.clear();
			if (placementOnly) selectionAnnouncer.announceIfMoved();
			else selectionAnnouncer.announce();
		},
		getDoc: () => doc
	});
	const widgetSelection = createWidgetSelectionState({
		onSelect: () => {
			window.getSelection()?.removeAllRanges();
			// Announced like the `source` swap: dropping the native range ends the document
			// caret without moving any field the clear checks, and the native `selectionchange`
			// it fires stops on the empty range before it reaches subscribers.
			selectionState.batch(() => {
				selectionState.clear();
				selectionState.announceSelection();
			});
		}
	});

	// Resolved from the live document on each read: an image's own commits move its end byte.
	const selectedWidget: SelectedWidgetHandle = {
		range: () => {
			const target = widgetSelection.getSelected();
			const image = target && imageAtTarget(doc, target, reading);
			return target && image
				? { path: [...target.paragraphPath], start: image.start, end: image.end }
				: null;
		},
		clear: () => widgetSelection.clear()
	};

	// The caret a selected image stands for: the edge its selection came from, read off the live
	// image, since a resize moves its end while it stays selected.
	function selectedWidgetCaret(): EditorSelection | null {
		const selected = widgetSelection.getSelected();
		if (!selected) return null;
		const live = selectedWidget.range();
		const fromStart = selected.preSelectOffset === selected.sourceStart;
		const offset = live ? (fromStart ? live.start : live.end) : selected.preSelectOffset;
		const point = { path: [...selected.paragraphPath], offset };
		return { anchor: point, focus: point };
	}

	let selectionDescription = $derived(
		selectionState.isCrossBlock && selectionState.anchor && selectionState.focus
			? createSelectionDescription({ anchor: selectionState.anchor, focus: selectionState.focus })
			: ''
	);

	// Its own polite region: overwriting selectionDescription would drop the move from
	// the accessibility tree.
	let reorderAnnouncement = $state('');

	// Single elements, not per-block, so the hover/drag path adds no cost per mounted
	// component.
	let reorderGhost = $state<{ clientX: number; clientY: number; label: string } | null>(null);
	let reorderLine = $state<{ left: number; top: number; width: number } | null>(null);
	let dropCaret = $state<DropCaretRect | null>(null);

	$effect(() => {
		const dispose = events.on('edit', (e) => {
			operationsLog.record({
				op: e.op,
				path: e.path,
				detail: ('detail' in e ? e.detail : undefined) ?? {}
			});
			// A fresh resolver only on a real signature change: one per edit would re-render
			// every block that read it.
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

	// The one place `editEpoch` is bumped. It follows the content version rather than the `edit`
	// event, whose `input` is batched across a typing burst and would leave every decoration
	// source a pause behind the bytes; the tick keeps a source off a half-applied tree, and
	// skipping when there are no sources keeps an undecorated editor at zero work (perf:check).
	let notifiedVersion = contentVersion.read();
	$effect(() => {
		const version = contentVersion.read();
		if (version === notifiedVersion) return; // the mount run announces nothing
		notifiedVersion = version;
		if (decorationEngine.sourceCount > 0) void tick().then(() => decorationEngine.notifyEdit());
	});

	const documentSwap = createDocumentSwap({
		grammar: registryView.grammar,
		// Built below; a swap runs post-init, so the closures read past the TDZ.
		flushDebouncedCheckpoint: () => controller.flushDebouncedCheckpoint(),
		adoptDocument: (next) => {
			doc = next;
			blockIds = assignIds(doc.children);
		},
		bumpContentVersion: contentVersion.bump,
		clearBlockRefs: () => {
			blockRefs.length = 0;
		},
		get heightOracle() {
			return heightOracle;
		},
		undoManager,
		caretMemory,
		closeMenus: () => {
			blockMenu = null;
			inlineMenu.close();
			linkCard.close();
		},
		widgetSelection,
		selection: selectionState,
		// The counter bumps only when the link-reference signature differs; the resolver
		// refreshes regardless.
		adoptLinkReferences: (resolver, signature) => {
			const next = advanceSignatureEpoch(currentSignature, signatureEpoch, signature);
			currentResolver = resolver;
			currentSignature = next.signature;
			signatureEpoch = next.epoch;
		},
		events
	});

	// The `source !== lastSource` check is required:
	// see `docs/design/editor.md` § Reactive state plumbing.
	// svelte-ignore state_referenced_locally
	let lastSource = source;
	$effect(() => {
		if (source === lastSource) return;
		lastSource = source;
		documentSwap.swapTo(source);
	});

	/**
	 * The host's own header, mounted inside this root. Every rule that means "this is the
	 * editor's own content" asks here rather than keeping its own `contains` copy, which is
	 * how one gets missed. The focusout checks still use `contains`: for "did focus leave the
	 * whole widget", the header is part of the editor.
	 */
	function isHostChrome(node: Node | null): boolean {
		return !!node && !!headerEl && headerEl.contains(node);
	}

	// ── Block menu ──────────────────────────────────────────────────────

	// Opened by a right-click on prose with nothing selected; a right-click over a selection leaves
	// the formatting popover (the host's) in charge and only suppresses the native menu. Tables run
	// their own cell menu and have prevented the default first.
	let blockMenu = $state<BlockMenuModel | null>(null);

	// Every menu counts itself in on mount; transitions only, so a subscriber's first news is a
	// real menu.
	const menuPresence = createMenuPresence();
	let menuWasOpen = false;
	$effect(() => {
		const open = menuPresence.isOpen;
		if (open === menuWasOpen) return;
		menuWasOpen = open;
		events.emit('menuChange', open);
	});

	// ── Link card ───────────────────────────────────────────────────────

	// The caret snapshot and the entry checks live on the state, not on the callers, so the next
	// entry path cannot forget them. All three refuse a cross-block range outright; within one
	// block they differ by gesture: an unasked-for click must not interrupt a selection, the
	// create gesture wraps it, and the chord has already resolved it against what it opens.
	const linkCard = createLinkCardState({
		onOpen: () => linkCardCaret.saveCurrent(),
		canOpen: () => !selectionState.isCrossBlock && window.getSelection()?.isCollapsed !== false,
		canEnter: () => !selectionState.isCrossBlock,
		canOpenCreate: () =>
			!selectionState.isCrossBlock && window.getSelection()?.isCollapsed === false
	});

	// The card belongs to live mode alone; any other mode paints the destination bytes already.
	$effect(() => {
		if (effectiveMode !== 'live') linkCard.close();
	});

	// ── Hidden-run class check ──────────────────────────────────────────

	// Once per mode change, this check pays the getComputedStyle the per-keystroke hidden-run
	// test cannot afford, so the two lists of class names cannot drift apart unnoticed.
	$effect(() => {
		void effectiveMode;
		if (!editorEl) return;
		const root = editorEl;
		assertInvariant('marker-css-parity', () => checkMarkerCssParity(root));
	});

	// ── Root listeners ──────────────────────────────────────────────────

	// On the resolved scroll container, not the root: the block held in place fights whoever
	// scrolls that container, and in host mode that gesture happens outside the editor.
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		return installRevealAnchorRelease(target, () => revealAnchor.releaseAll());
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		// focusout bubbles, so reset only when focus leaves the editor entirely.
		return onRoot(root, 'focusout', (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next)) return;
			caretMemory.forget();
		});
	});

	// Its own effect: this reads no root binding, so pairing it with the focusout one
	// would make it wait for the bind and re-install on every root change.
	$effect(() =>
		onRoot(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				caretMemory.forget();
			}
		})
	);

	// The author's own input ends a pending pick's undo join, so typing while a plugin's onCommit
	// waits gets its own entry. Window capture runs before the root's handlers: the key that makes a
	// pick fires here before the pick's join opens.
	$effect(() => {
		const win = editorEl?.ownerDocument.defaultView;
		if (!win) return;
		const endJoin = (e: Event) => {
			// A held Shift or Ctrl is not input yet; the key it modifies is.
			if (e instanceof KeyboardEvent && BARE_MODIFIER_KEYS.includes(e.key)) return;
			controller.endUndoJoin();
		};
		const removers = ['keydown', 'beforeinput', 'paste', 'cut', 'drop'].map((type) =>
			onRoot(win, type, endJoin, { capture: true })
		);
		return () => removers.forEach((remove) => remove());
	});

	// Register as a body-chord handler so the document-level keydown routes a body-level
	// chord to exactly one instance: a lone editor takes it unconditionally; among several,
	// the last-interacted one wins.
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

	const getBlockElByPath: BlockElLookup = (path) =>
		editorEl ? blockContentElAt(editorEl, path) : null;

	// The non-scrolling sibling of revealPath, and the one descent both the rect API
	// and the test hooks use: a second closure would drift from it.
	function getBlockComponent(path: number[]): BlockComponent | null {
		if (path.length === 0) return null;
		const [first, ...rest] = path;
		const ref = blockRefs[first];
		if (!ref) return null;
		if (rest.length === 0) return ref;
		return ref.getBlockComponentByPath?.(rest) ?? null;
	}

	// ── Action Bundles ──────────────────────────────────────────────────

	// Hoisted so the deps literal below can reference it before the windowing state it
	// reads is declared; the body runs only at call time, after init.
	async function revealPath(path: number[]): Promise<BlockComponent | null> {
		if (path.length === 0) return null;
		const top = path[0];
		// The shared mount-and-wait check skips an already-mounted block, re-checks after a
		// spurious cross-level recompute, and gives up rather than hanging when a stale
		// height table left `top` outside the recomputed window (VR-5).
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
		caretMemory,
		selectionState,
		getSelectedWidgetCaret: selectedWidgetCaret,
		getBlockElByPath,
		revealPath,
		events,
		reading
	};
	const { blockEdit, focus, history, containerEdit, controller } =
		createEditorActions(editorActionsDeps);

	// A getter, so block components read the live doc at keystroke time rather than
	// the snapshot they mounted with.
	const getDoc: DocumentGetter = () => doc;

	// Ahead of the plugin contexts because `decorations` is handed into
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
		// A navigation keeps the block it scrolled to in place, unlike the consumer restore
		// path: nothing after it wants the viewport back, and the held position should outlive
		// a late image decode.
		landCaretAt: landCaretAtOffset
	});

	const editorId = mintEditorId();

	// The typed-trigger menus (`#tag`, `[[link`). The write is the same one-entry range splice the
	// link card and the image popover use, so a pick undoes in one press.
	const inlineMenuCommit = createInlineRangeCommit({ getDoc, controller, reading });
	const inlineMenu = createInlineMenuState({
		getDoc,
		getSelection,
		getMode: reading.mode,
		events,
		editorId,
		reading,
		commitRange: inlineMenuCommit.commitInlineRange,
		landCaret: landCaretAtOffset,
		joinUndoEntries: (run) => controller.joinUndoEntries(run)
	});
	const inlineMenus: InlineMenuRegistry = inlineMenu.registry;
	$effect(() => () => inlineMenu.dispose());

	// After getDoc so it reuses that one live-doc closure: a second getDoc would be a
	// TDZ reference here, and the rule is one getter, never a captured value.
	const pluginContexts = createEditorPluginContexts({
		editorId,
		getDoc,
		events,
		optionsFor: (name) => pluginEntries?.optionsByName.get(name),
		decorations,
		rects,
		inlineMenus,
		getDocumentGeneration: documentSwap.generation,
		// The one place the mode enters the dispatch levels; they read it back through
		// the pluginEditor lookup they already pass around.
		getPresentationMode: reading.mode,
		getTheme: () => theme,
		activation: activePlugins,
		// Called at use, never here: both read state declared further down this component.
		insertMarkdown: (md, options) => insertMarkdown(md, options),
		runCommand: (commandId, arg) => runCommand(commandId, arg),
		computeInlineContent: inlineReaderFor(registryView.grammar)
	});

	// One definition, passed by every dispatch level that can reach a plugin-global
	// handler, so block, cross-block and editor-root route identically.
	const pluginEditorLookup: PluginEditorLookup = (name) => pluginContexts.get(name);
	const commandErrorSink: CommandErrorSink = (report) => emitCommandError(events, report);

	// onMount, never a plain $effect: attachAll synchronously runs plugin callbacks that
	// read reactive state, so an effect would take doc.children as a dependency and the
	// first structural edit would dispose every subscription.
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

	// The document caret while the search bar or the link card holds focus
	// (selection/caret-restore.ts). One instance each: a card opened over an open search bar
	// would otherwise overwrite the pre-search caret, and closing the bar would leave the
	// user at the link.
	const searchCaret = createCaretRestore(() => editorEl ?? null);
	const linkCardCaret = createCaretRestore(() => editorEl ?? null);

	const searchReplace = createSearchReplace(editorActionsDeps, controller);
	// Find stays live in reading mode; replace is an edit and does nothing here.
	const gatedSearchReplace: typeof searchReplace = {
		replaceOne: (match, template) =>
			canReplace ? searchReplace.replaceOne(match, template) : Promise.resolve(0),
		replaceAll: (matches, template) =>
			canReplace ? searchReplace.replaceAll(matches, template) : Promise.resolve(0)
	};
	const searchState = createSearchState({
		getDoc,
		getDocumentGeneration: documentSwap.generation,
		decorations,
		replace: gatedSearchReplace,
		// Goes through the one public scroll call, which also decides which block is held
		// in place (the top one by default, which is what search wants), so a late image
		// decode cannot scroll the match away.
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

	// Cleared first for the same reason as the reorder announcement: two headings typed in a row
	// would otherwise announce once.
	let kindAnnouncement = $state('');
	const kindCue = createKindCue({
		getDoc,
		getPresentationMode: reading.mode,
		announce: async (label) => {
			kindAnnouncement = '';
			await tick();
			kindAnnouncement = label;
		}
	});

	// ── Context provision ───────────────────────────────────────────────

	// One per instance, shared by every dispatch site's checks: the chord handler, a block's
	// rebound chord and `runCommand` must all reach the same cross-block code.
	const crossBlockCommands = createCrossBlockCommands({
		selection: selectionState,
		getDoc,
		getBlockElByPath,
		revealPath,
		controller,
		reading,
		getContentVersion: contentVersion.read,
		caretMemory
	});

	// The action bundles stay one per context key so a container re-provides exactly what
	// it overrides; the history bundle must have a single provider (G1.4).
	setContext(BLOCK_EDIT_KEY, blockEdit);
	setContext(FOCUS_KEY, focus);
	setContext(HISTORY_KEY, history);
	setContext(CONTAINER_EDIT_KEY, containerEdit);

	setContext(EDITOR_SERVICES_KEY, {
		events,
		decorations: decorationEngine,
		selection: selectionState,
		search: searchState,
		caretMemory,
		autoPairs,
		revealAnchor,
		widgetSelection,
		selectedWidget,
		linkCard,
		inlineMenuCombobox: inlineMenu.comboboxFor,
		controller,
		pasteCoordinator,
		reorder,
		reorderAnnounce: announceReorder,
		registryView,
		activePlugins,
		rects,
		crossBlockCommands,
		menuPresence,
		kindCue
	} satisfies EditorServices);

	setContext(EDITOR_POLICIES_KEY, {
		resolveImageUrl: resolveImageUrlImpl,
		resolveLinkUrl: resolveLinkUrlImpl,
		imageLoadPolicy: () => imageLoadPolicy,
		// Reading mode turns the drag handles off through the prop's own getter.
		blockDragHandles: () => blockDragHandles && effectiveMode !== 'reading',
		presentationMode: reading.mode,
		theme: () => theme,
		keybindingOverrides: () => overridesMap,
		// An accessor, not the `onPasteImage,` shorthand, which would capture the prop's value.
		get onPasteImage() {
			return onPasteImage;
		},
		// Accessors for the same reason as onPasteImage above.
		get onRunCode() {
			return onRunCode;
		},
		get codeMenuItems() {
			return codeMenuItems;
		},
		brokenImageUrls
	} satisfies EditorPolicies);

	// ── Root DOM effects ────────────────────────────────────────────────

	// The pre half runs while the outgoing mode still owns the DOM, the post half after the
	// mode's render key has rebuilt every block; the factory carries the caret across the gap.
	const modeFlip = createModeFlip({
		get editorEl() {
			return editorEl;
		},
		get mode() {
			return reading.mode();
		},
		selection: selectionState,
		getSelection,
		announceSelection: selectionAnnouncer.announce,
		getBlockElByPath,
		isHostChrome,
		caretMemory,
		// Built below; a mode switch runs after init, so the getter reads past the TDZ.
		get heightOracle() {
			return heightOracle;
		},
		events,
		restoreCaret: (path, offset) => restoreThroughRevealRoad(caretAt(path, offset), 'mount')
	});
	$effect.pre(() => {
		const mode = presentationMode;
		untrack(() => {
			modeFlip.beforeFlip(mode);
			effectiveMode = mode;
		});
	});
	$effect(() => {
		modeFlip.afterFlip(effectiveMode);
	});

	// ── Root gestures ───────────────────────────────────────────────────

	const rootGestures = createRootGestures({
		getDoc,
		selection: selectionState,
		caretMemory,
		getBlockElByPath,
		getBlockComponent,
		revealPath,
		getScrollHost,
		getLifetime: () => lifetimeController.signal,
		isHostChrome,
		activateLink,
		linkCard,
		reading,
		widgetSelection
	});
	// The drop handler installs on the same root; its deps are the paste pipeline's, not a
	// gesture's.
	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		return removeAll(
			rootGestures.install(root),
			installSelectionDrop({
				editorRoot: root,
				getDoc,
				controller,
				coordinator: pasteCoordinator,
				reading,
				activePlugins,
				events,
				setDropCaret: (rect) => (dropCaret = rect),
				isReadOnly: () => effectiveMode === 'reading'
			})
		);
	});

	const rootMenus = createRootMenus({
		get editorEl() {
			return editorEl;
		},
		get mode() {
			return reading.mode();
		},
		getDoc,
		isHostChrome,
		blockEdit,
		placeCaretAtPoint,
		insertMarkdown,
		insertCatalogue: getInsertCatalogue,
		activation: activePlugins,
		setMenu: (menu) => (blockMenu = menu)
	});

	// A theme change invalidates no live edit, so it only has to be announced, for plugins
	// that paint their own colors and cannot see the change through CSS.
	// svelte-ignore state_referenced_locally
	let lastTheme = theme;
	$effect(() => {
		const next = theme;
		if (next === lastTheme) return;
		lastTheme = next;
		events.emit('themeChange', next);
	});

	// CSS keys on `data-cross-block` to hide the native caret and selection highlight
	// while the overlay paints the cross-block range. Keyed on the overlay's own test: a
	// state it does not paint must not also lose the caret, or the screen shows neither.
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
			announceIfMoved: selectionAnnouncer.announceIfMoved,
			isWidgetSelected: () => widgetSelection.getSelected() !== null
		});
	});

	$effect(() => {
		if (!editorEl) return;
		return installEditorBlurAnnouncer({
			root: editorEl,
			announce: selectionAnnouncer.announce
		});
	});

	// ── Editor-root keydown routing ──────────────────────────────────────
	//
	// When the caret's block windows out, focus drops to <body> and the per-block keydown handlers
	// go silent, so this editor-level handler reuses the same cross-block composer with the root
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
		caretMemory,
		blockEdit,
		controller,
		history,
		pluginEditor: pluginEditorLookup,
		reading,
		onCommandError: commandErrorSink,
		crossBlockCommands,
		pasteCoordinator,
		getKeybindingOverrides: () => overridesMap,
		activePlugins,
		events,
		getCursorOffset: () => selectionState.focus?.offset ?? null,
		selectedWidget,
		afterReactivity: () => tick()
	});

	// Document-level chords for a caret whose block is not mounted, plus the search shortcuts.
	// Every handler is limited to this instance: the listener sees every editor's keystrokes
	// on the page, so an unguarded one would let a single Ctrl+Z revert two editors.
	const rootKeydown = createEditorRootKeydown({
		get searchBarEnabled() {
			return searchBar;
		},
		get mode() {
			return reading.mode();
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
		activation: activePlugins,
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
	// the selection found no text position to put a caret in. Limited the same way: the handlers
	// take only events on this root, or on the body with this instance holding the chord.
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

	// ── Height estimates ────────────────────────────────────────────────

	// How far the host scaled the type from the size HEIGHT_ESTIMATES were calibrated
	// at. Plain `let`, not `$state`: `estimate()` reads it on windowing's hottest path,
	// and `widthVersion` is already the rebuild signal.
	let typeScale = 1;

	// Only the font-relative terms scale: a block's padding is absolute and an image's
	// height is its own. Getters, so a scale change takes effect without rebuilding
	// `heightOracle` or dropping its measured heights.
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

	// A width change re-wraps prose and makes every cached height wrong, so the block lists
	// rebuild off this counter; a height-only resize spares the measured cache.
	let widthVersion = $state(0);
	$effect(() => {
		if (!editorEl) return;
		return installWidthWatcher(editorEl, () => {
			heightOracle.dropMeasured();
			widthVersion++;
		});
	});

	// Watched on the resolved scroll container: how many blocks the window holds comes from
	// that container's height, so a height-only resize would otherwise leave the newly exposed
	// strip as an empty div until the next scroll. Its own counter, never `widthVersion`: that
	// one drops every measured height, which a resize re-wrapping no prose has not earned.
	let viewportHeightVersion = $state(0);
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		return installViewportHeightWatcher(target, () => viewportHeightVersion++);
	});

	// ── Type scale ──────────────────────────────────────────────────────

	// A font-size change puts the estimates off several-fold, and no other box in the root
	// reports it; the measured scale follows the width counter, since a rebuild is what it needs.
	$effect(() => {
		if (!typeScaleProbeEl) return;
		return installTypeScaleProbe(typeScaleProbeEl, {
			getScale: () => typeScale,
			onScale: (next) => {
				typeScale = next;
				heightOracle.dropMeasured();
				widthVersion++;
			}
		});
	});

	// ── Header height compensation ──────────────────────────────────────

	$effect(() => {
		const el = headerEl;
		if (!el || !editorEl) return;
		const port = getScrollport();
		if (!port) return;
		return installHeaderSlotCompensation({
			el,
			port,
			ownsScrollCorrection,
			revealHoldsScroll: () => topWindowing.revealHoldsScroll()
		});
	});

	// ── Focus attribution ───────────────────────────────────────────────

	const focusAttribution = createFocusAttribution({
		get mode() {
			return reading.mode();
		}
	});
	$effect(() => {
		void effectiveMode;
		focusAttribution.applyForMode();
	});
	$effect(() => {
		if (!editorEl) return;
		return focusAttribution.install(editorEl);
	});

	// ── Top-level windowing ─────────────────────────────────────────────

	// Assembled here, after the windowing signals it holds exist; the block
	// components and the windowing hook below both read it back through getContext.
	setContext(EDITOR_DOC_KEY, {
		doc: getDoc,
		contentVersion: contentVersion.read,
		reading,
		pluginEditor: pluginEditorLookup,
		lifetime: lifetimeController.signal,
		editorRoot: () => editorEl ?? null,
		scrollHost: getScrollHost,
		scrollport: getScrollport,
		blockElLookup: getBlockElByPath,
		focusedPath: focusAttribution.getFocusedPath,
		heightOracle,
		correctsScroll: ownsScrollCorrection,
		widthVersion: () => widthVersion,
		viewportHeightVersion: () => viewportHeightVersion
	} satisfies EditorDoc);

	// getListEl is the inner .block-list wrapper, never editorEl (== scrollEl): it
	// scrolls with content, so its top maps root scrollTop into local coordinates,
	// where editorEl would collapse to 0.
	const topWindowing = useContainerWindowing({
		getIndex: () => 0, // ignored: the root has no parent to report to
		getParentPath: () => [],
		getChildren: () => doc.children,
		getChildIds: () => blockIds,
		getListEl: () => editorEl?.querySelector(':scope > .block-list') ?? null,
		provideLeafChannel: true
	});

	// Plain `let`, not $state or $derived: the scroll correction asks for this mid-measure,
	// where evaluating the window derived would force a layout read (VR-4). It lags the
	// derived by one flush when windowing switches on or off.
	let rootWindowingActive = false;
	$effect(() => {
		rootWindowingActive = topWindowing.window.active;
	});

	// Who keeps the user's place when a height changes. Self mode always; host mode only while
	// windowing runs, since below that threshold the browser's own scroll anchoring does it and
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
		return readCurrentSelection(selectionState, blockRefs, selectedWidgetCaret);
	}

	/**
	 * The one restore path: resolve and clamp, scroll into view, place the caret. `reveal` picks
	 * how. The two scrolling ones differ in whether the block stays held in place after the call:
	 * a navigation holds it, a consumer restore hands the viewport back so a held block cannot
	 * override the host's next scroll. `mount` is the history swap's bare mount, which only
	 * mounts the block and in exchange writes no scroll position.
	 */
	function restoreThroughRevealRoad(
		selection: EditorSelection,
		reveal: 'hold' | 'release' | 'mount'
	): Promise<SelectionRestoreOutcome> {
		return restoreSelection(selection, {
			getDoc,
			selectionState,
			getBlockElByPath,
			caretMemory,
			revealTarget: async (path) =>
				reveal === 'mount'
					? (await revealPath(path)) !== null
					: rects.scrollTo(path, { block: 'nearest', hold: reveal === 'hold' })
		});
	}

	function caretAt(path: number[], offset = 0): EditorSelection {
		return { anchor: { path, offset }, focus: { path, offset } };
	}

	/** Put the caret at a raw offset through the shared restore path: how the link card hands
	 *  focus back after a commit, so the next keystroke (Ctrl+Z included) goes to the document. */
	async function landCaretAtOffset(path: number[], offset: number): Promise<boolean> {
		return (await restoreThroughRevealRoad(caretAt(path, offset), 'hold')) === 'applied';
	}

	/**
	 * Restore a snapshot from {@link getSelection}, sharing the whole restore path with the
	 * undo swap and plugin navigation so the three cannot diverge. True only if the selection
	 * was placed and its focus block is in view; a later programmatic scroll while this is
	 * still settling owns the viewport and makes this false, while a user gesture does not.
	 */
	export async function setSelection(selection: EditorSelection): Promise<boolean> {
		return (await restoreThroughRevealRoad(selection, 'release')) === 'applied';
	}

	// The same search a click on empty space runs, minus the event and target checks a host
	// caller has already done for itself. See `editor-props.ts` for the contract.
	export function placeCaretAtPoint(x: number, y: number): boolean {
		return editorEl ? rootGestures.placeCaretAtPoint(editorEl, x, y) : false;
	}

	// The entry points below only resolve the focused editable; their rules live in that
	// editable itself. See `editor-props.ts` for each contract.
	const focusedSurface = createFocusedSurface({
		get editorEl() {
			return editorEl;
		},
		selection: selectionState,
		getDoc,
		getBlockComponent,
		isReading: () => effectiveMode === 'reading',
		insertParagraph: (boundary, text) => blockEdit.insertParagraph(boundary, text),
		joinUndoEntries: (run) => controller.joinUndoEntries(run)
	});

	export function insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean> {
		return focusedSurface.insertMarkdown(md, options);
	}

	const commandDispatchContext: CommandDispatchContext = {
		history,
		pluginEditor: pluginEditorLookup,
		activation: activePlugins,
		getPresentationMode: reading.mode,
		isCrossBlockRange: () => selectionState.isCrossBlock,
		crossBlockCommands: crossBlockCommands
	};

	export function runCommand(commandId: string, arg?: unknown): boolean {
		return runCommandById(
			commandId as AnyCommandId,
			arg,
			focusedSurface.commandTarget(),
			commandDispatchContext,
			commandErrorSink
		);
	}

	// Asks through the same path `runCommand` dispatches through, so what a host greys out and
	// what a click refuses cannot drift. See `editor-props.ts` for the contract.
	export function canRunCommand(commandId: string): boolean {
		return canRunCommandById(
			commandId as AnyCommandId,
			focusedSurface.commandTarget(),
			commandDispatchContext
		);
	}

	// State, not whether it is allowed: the focused editable reports its own toggle state, so a
	// toolbar's pressed look reads the same bytes the toggle would rewrite. See `editor-props.ts`.
	export function isCommandActive(commandId: string): boolean {
		return isCommandActiveById(
			commandId as AnyCommandId,
			focusedSurface.commandTarget(),
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

	export function getInlineMenus(): InlineMenuRegistry {
		return inlineMenus;
	}

	export function getInsertCatalogue(): readonly InsertEntry[] {
		return insertCatalogue(activePlugins);
	}

	export function getRects(): EditorRects {
		return rects;
	}

	// Recomposed per call rather than derived: the kind and plugin registries are
	// process-global and mutate outside this component's reactive graph.
	export function reservedChords(): ReadonlySet<string> {
		return collectReservedChords({
			searchBar,
			keybindings: overridesMap,
			activation: activePlugins
		});
	}

	export function claimsChord(event: KeyboardEvent): boolean {
		return chordIsClaimed(event, reservedChords());
	}

	const diagnostics = createEditorDiagnostics({ getSelection, getSource, operationsLog });

	export function getDiagnostics(): EditorDiagnostics {
		return diagnostics;
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
		isCommandActive,
		getEvents,
		getSearch,
		getDecorations,
		getInlineMenus,
		getInsertCatalogue,
		getRects,
		getDiagnostics,
		reservedChords,
		claimsChord
	} satisfies EditorInstance);

	// ── Test-only hooks ─────────────────────────────────────────────────

	export const __test: EditorTestSurface = {
		getDocument: () => doc,
		getGrammar: () => registryView.grammar,
		getContentVersion: contentVersion.read,
		getBlockComponent,
		getUndoStack: () => undoManager.getStacks(),
		getOperationsLog: () => operationsLog,
		isCrossBlockActive: () => selectionState.isCrossBlock,
		getGapCaret: () => selectionState.gapCaret,
		getDecorationEngine: () => decorationEngine,
		getHeightOracle: () => heightOracle,
		getWidthVersion: () => widthVersion,
		setBlockRefSlot: blockRefSlots.set
	};
</script>

<!-- tabindex="-1": focusable so an unmounted block hands focus here rather than to
	<body>, but not tab-reachable. Non-editable, so focusing it creates no native
	selection for the selectionchange bridge to collapse. -->
<!-- data-presentation is left off in source mode on purpose: the default path's DOM
	stays byte-identical, and reading-mode CSS keys on the attribute being present. -->
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
	oncontextmenu={rootMenus.onRootContextMenu}
>
	{#if searchBar}
		<!-- Zero-height sticky anchor, so the bar does not scroll away with content. Portaled
		     out, it drops that positioning (the consumer's element is the box) and takes the
		     editor's own theme class, since custom properties resolve by DOM ancestry. -->
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
	<!-- One `em` tall and out of flow: its box is the root's computed font size, which
	     no other box reports, and windowing's activation decision needs that scale. -->
	<div class="type-scale-probe" bind:this={typeScaleProbeEl} aria-hidden="true"></div>
	{#if header}
		<!-- A sibling of the block list, never a wrapper: windowing finds its list as a
		     direct child of this root. -->
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
	<!-- A sibling of the list like the header: windowing wants the list bare. -->
	<TailInsert {blockEdit} childCount={doc.children.length} readOnly={effectiveMode === 'reading'} />
	{#if blockMenu}
		<BlockMenu
			x={blockMenu.x}
			y={blockMenu.y}
			anchor={blockMenu.anchor}
			items={blockMenu.items}
			label={blockMenu.label}
			onPick={blockMenu.pick}
			onClose={() => (blockMenu = null)}
			{menuPresence}
		/>
	{/if}
	{#if selectionToolbar && effectiveMode !== 'reading'}
		<SelectionToolbar
			editor={{
				getSelection,
				getRects,
				getBlockKindAt,
				runCommand,
				canRunCommand,
				isCommandActive,
				getEvents
			}}
			root={editorEl}
		/>
	{/if}
	<ImageOverlayHost
		{widgetSelection}
		{controller}
		{events}
		{getDoc}
		getContentVersion={contentVersion.read}
		getEditorEl={() => editorEl ?? null}
		getSelectionIsCustomRendered={() => selectionState.isCustomRendered}
		lifetime={lifetimeController.signal}
		{menuPresence}
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
		{reading}
		{menuPresence}
	/>
	<InlineMenuHost
		menu={inlineMenu}
		{events}
		{menuPresence}
		getEditorEl={() => editorEl ?? null}
		measureRange={rects.rangeRects}
	/>
	<div class="editor-sr-live" role="status" aria-live="polite">{selectionDescription}</div>
	<div class="editor-sr-live-reorder" role="status" aria-live="polite">{reorderAnnouncement}</div>
	<div class="editor-sr-live-kind" role="status" aria-live="polite">{kindAnnouncement}</div>
	{#if reorderLine}
		<div
			class="reorder-line"
			style="left:{reorderLine.left}px;top:{reorderLine.top}px;width:{reorderLine.width}px"
		></div>
	{/if}
	{#if dropCaret}
		<div
			class="drop-caret"
			style="left:{dropCaret.left}px;top:{dropCaret.top}px;height:{dropCaret.height}px"
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
		/* Wider on the left: the drag handle lives in that gutter, 1.25rem out from the content,
		   and the rest of this padding is what keeps it off the scroll container's border. */
		padding: 1rem 1rem 1rem 1.5rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		/* The type-scale root: every construct sizes in `em` off this, so one
		   declaration scales the whole editor. */
		font-size: var(--editor-font-size, 1rem);
		line-height: 1.6;
		/* Inherit rather than assume a dark host: an unthemed page keeps its own text color. */
		color: var(--color-text-primary, currentColor);
		min-height: 200px;
		overflow-y: auto;
		/* The editor corrects the scroll position by hand (list-windowing's correctAnchor);
		   the browser's own anchoring rewrites scrollTop as well, and the two double-correct.
		   Do not restore `overflow-anchor` (VR-2). */
		overflow-anchor: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border, #3e3e3b) transparent;
		/* No border or outline: a document is the page's content, not a widget on it. */
		/* Containing block for the image overlay portal. */
		position: relative;
	}

	/* Embedded flow mode: an ancestor owns the scroll, so the root gives up its own scroll
	   container and the standalone-widget frame that would box every entry of a journal. Below
	   the windowing threshold nothing corrects by hand, so the browser's anchoring is restored:
	   `none` would strip the subtree from the host's anchor candidates and hold nothing. */
	.editor[data-scroll-mode='host'] {
		overflow-y: visible;
		overflow-anchor: auto;
		min-height: 0;
		flex: none;
		border: none;
		padding: 0;
	}

	/* The trade windowing makes under host scroll: the browser's anchoring and the manual
	   correction cannot coexist, so an active editor withdraws its own subtree from the host's
	   anchor candidates and holds the position itself (VR-2). The host's scroller is untouched. */
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

	/* Sticks to the top of the scroll container reserving no space; the bar positions
	   absolutely against it and stays put as the editor scrolls. */
	.search-anchor {
		position: sticky;
		top: 0;
		height: 0;
		z-index: 5;
	}

	/* Sticky resolves against the nearest scroll container, which in flow mode is the host's,
	   floating the bar over unrelated page content; absolute puts it back on the root. */
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
	.editor-sr-live-reorder,
	.editor-sr-live-kind {
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
	   temporary wash, deliberately not an outline (a document should feel like a
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

	/* Where a held drag will land: the browser's own drop caret goes with the drop the editor
	   cancels, so this one takes its place. */
	.drop-caret {
		position: fixed;
		width: 1.5px;
		background: var(--color-text-primary, currentColor);
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
