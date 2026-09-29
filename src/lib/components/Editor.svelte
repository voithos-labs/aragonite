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
	import { docPathFrom } from '../cursor/coordinate-spaces';
	import { createAutoPairRecord } from './blocks/text/auto-pair-record';
	import { createScrollOwner } from '../cursor/scroll-owner';
	import { createHeightOracle } from '../cursor/height-oracle';
	import { HEIGHT_ESTIMATES } from '../cursor/typography-estimates';
	import { createScrollHostResolution } from './editor-root-scroll-host';
	import { installSelectionDrop, type DropCaretRect } from '../selection/selection-drop';
	import { createContentVersion } from '../reactivity/content-version.svelte';
	import { useContainerWindowing } from '../reactivity/use-container-windowing.svelte';
	import { refSlotsOver, replaceRefs } from '../reactivity/publish-ref.svelte';
	import { componentAt, type ChildList } from '../reactivity/child-list';
	import { createSelectionState } from '../selection/selection-state.svelte';
	import { coverRange, rangeCoverage } from '../selection/range-coverage';
	import { createSelectionDescription } from '../selection/selection-description';
	import { EDITOR_LABEL } from '../a11y-strings';
	import TailInsert from './TailInsert.svelte';
	import BlockMenu from './menu/BlockMenu.svelte';
	import { createMenuPresence } from './menu/menu-presence.svelte';
	import type { EditorSelection } from '../selection/primitives';
	import { createWidgetSelectionState } from './image/widget-selection-state.svelte';
	import { imageAtTarget } from './image/image-edit-commit';
	import type { SelectedWidgetHandle } from '../selection/primitives';
	import { assignIds } from '../block-id';
	import { createDocumentSwap, initDocument } from './editor-root-document-swap';
	import { blockNodeAt } from '../tree-operations/node-primitives';
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
	import { createCaretLanding } from '../selection/caret-landing';
	import { installReorderDrag } from '../editor-actions/reorder-drag';
	import { createPasteCoordinator } from '../editor-actions/paste-coordinator';
	import { createOperationsLog } from '../debug/operations-log';
	import { createEditorDiagnostics } from '../debug/editor-diagnostics';
	import { readCurrentSelection } from '../selection/native-bridge';
	import { createCaretRestore } from '../selection/caret-restore';
	import { createCrossBlockHandlers } from '../selection/cross-block/dispatch';
	import { createCrossBlockCommands } from '../selection/cross-block/format-toggle';
	import { normalizeKeybindingOverrides } from '../schema/keybinding-overrides';
	import { createEditorRootKeydown } from './editor-root-keydown';
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
		installUndoStepEnd,
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
	import { hidesDelimitersAtCaret, type PresentationMode } from '../presentation-mode';
	import BlockList from './BlockList.svelte';
	import SearchBar from './SearchBar.svelte';
	import SelectionToolbar from './menu/SelectionToolbar.svelte';
	import ImageOverlayHost from './image/ImageOverlayHost.svelte';
	import LinkCardHost from './link-card/LinkCardHost.svelte';
	import InlineMenuHost from './menu/InlineMenuHost.svelte';
	import { createInlineMenuState } from '../inline-menu/inline-menu-state.svelte';
	import type { InlineMenuRegistry } from '../inline-menu/types';
	import { createInlineRangeCommit } from '../editor-actions/inline-range-commit';
	import { replaceBlockRaw } from '../editor-actions/block-edit-core';
	import { createLinkCardState } from './link-card/link-card-state.svelte';
	import { runStartupInvariantChecks } from '../invariants/install';
	import { assertInvariant } from '../assert';
	import { checkMarkerCssParity } from '../invariants/marker-css-parity';
	import { registerEditorBuiltIns } from './editor-built-ins';
	import { blockContentElAt } from './block-el-lookup';

	registerEditorBuiltIns();
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

	// Read once: `scrollMode` is fixed at mount, and a live read would join windowing's hottest path.
	// svelte-ignore state_referenced_locally
	const hostScroll = scrollMode === 'host';

	const { getScrollHost, getClipBounds } = createScrollHostResolution({
		get editorEl() {
			return editorEl;
		},
		hostScroll
	});

	// Installed before the first parse of `source`; a later change to `plugins` is ignored.
	// svelte-ignore state_referenced_locally
	const pluginEntries = plugins?.length ? normalizePluginEntries(plugins) : undefined;
	if (pluginEntries) installPlugins(pluginEntries.plugins);

	// The editor activates exactly the plugins it lists; with no `plugins` prop, every installed
	// plugin stays active.
	const activePlugins = pluginEntries
		? activationFor(pluginEntries.plugins.map((p) => p.name))
		: everyInstalledPlugin;

	const overridesMap = $derived(normalizeKeybindingOverrides(keybindings));

	// The one mode every reader reports, and the one place effective and requested could differ.
	const effectiveMode = $derived(presentationMode);
	// Set only while a mode switch commits the outgoing mode's pending edits, so they land in the
	// mode they were typed in.
	let outgoingMode = $state<PresentationMode | null>(null);
	// Replace is an edit, so reading mode never offers it (the commit refuses the write anyway).
	const canReplace = $derived(effectiveMode !== 'reading');

	const resolveImageUrlImpl: ResolveImageUrl = (u) => (resolveImageUrl ? resolveImageUrl(u) : u);
	const resolveLinkUrlImpl: ResolveLinkUrl = (u) => (resolveLinkUrl ? resolveLinkUrl(u) : u);
	const activateLink = (url: string, event: MouseEvent) =>
		onLinkActivate
			? onLinkActivate(url, event)
			: defaultLinkActivation(url, event, (blocked) => emitBlockedLinkError(events, blocked));

	// ── State ───────────────────────────────────────────────────────────

	// This editor's view of the global registries; `__registryEnablement` narrows it in tests.
	// svelte-ignore state_referenced_locally
	const registryView = createRegistryView({
		plugins: pluginEntries ? activePlugins : undefined,
		isEnabled: __registryEnablement,
		syntax
	});

	// Plain state, not $derived: structural edits write `doc` and `blockIds` directly.
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
		mode: () => outgoingMode ?? effectiveMode,
		hidesDelimitersAtCaret: () => hidesDelimitersAtCaret(outgoingMode ?? effectiveMode)
	};
	// The root list's child component refs, plain rather than `$state` (see `refSlotsOver`).
	const blockRefs: (BlockComponent | undefined)[] = [];
	const blockRefSlots = refSlotsOver(blockRefs);
	let editorEl: HTMLDivElement | undefined = $state();
	// A portaled search bar inside a themed host skips the theme class, whose defaults would
	// shadow the host's tokens.
	const inThemedScope = $derived(!!editorEl?.closest('.aragonite-editor-theme'));
	let headerEl: HTMLDivElement | undefined = $state();
	let typeScaleProbeEl: HTMLDivElement | undefined = $state();
	const undoManager = createUndoManager();
	const sharing = createSharingState();
	const caretMemory = createCaretMemory();
	const autoPairs = createAutoPairRecord();
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
	// With no live range this reads no document bytes, so a keystroke at a caret costs nothing here.
	const coverage = $derived.by(() => {
		const { anchor, focus } = selectionState;
		if (!selectionState.isCustomRendered || !anchor || !focus) return null;
		return rangeCoverage(doc, coverRange(doc, anchor, focus));
	});
	const widgetSelection = createWidgetSelectionState({
		onSelect: () => {
			window.getSelection()?.removeAllRanges();
			// Announced explicitly: the native `selectionchange` from dropping the range never
			// reaches subscribers, and the clear sees no field move.
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

	// The caret a selected image stands for, read off the live image since a resize moves its end.
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

	// The edit live region, its own: sharing `selectionDescription`'s would drop a move's
	// announcement. Only the undo controller speaks here, from a commit that wrote.
	let editAnnouncement = $state('');
	const announceEdit = async (message: string) => {
		// Clear first: Svelte skips the DOM write on a ===-equal assignment, which drops
		// the second of two identical announcements.
		editAnnouncement = '';
		await tick();
		editAnnouncement = message;
	};

	// One element each for the whole editor, so dragging costs nothing per mounted block.
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

	// The one place `editEpoch` is bumped, off the content version because the `edit` event
	// batches a typing burst; the tick keeps decoration sources off a half-applied tree.
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
		noteTreeSwap: () => caretLanding.noteTreeSwap(),
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
		closeMenus,
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

	// The equality check is required: `docs/design/editor.md` § Reactive state plumbing.
	// svelte-ignore state_referenced_locally
	let lastSource = source;
	$effect(() => {
		if (source === lastSource) return;
		lastSource = source;
		documentSwap.swapTo(source);
	});

	/** Whether `node` is in the host's header; every "is this editor content" check asks here.
	 *  Focus tracking uses `contains` instead, since the header counts as part of the editor. */
	function isHostChrome(node: Node | null): boolean {
		return !!node && !!headerEl && headerEl.contains(node);
	}

	// ── Block menu ──────────────────────────────────────────────────────

	// Opened by a right-click on prose with nothing selected; over a selection the host's
	// formatting popover stays in charge, and tables run their own cell menu.
	let blockMenu = $state<BlockMenuModel | null>(null);

	// Emits on open/close transitions only, so a subscriber's first event is a real menu.
	const menuPresence = createMenuPresence();
	let menuWasOpen = false;
	$effect(() => {
		const open = menuPresence.isOpen;
		if (open === menuWasOpen) return;
		menuWasOpen = open;
		events.emit('menuChange', open);
	});

	// ── Link card ───────────────────────────────────────────────────────

	// The caret snapshot and entry checks live on the link card state so no entry path skips
	// them. Each refuses a cross-block range; a click also refuses a selection, which create needs.
	const linkCard = createLinkCardState({
		onOpen: () => linkCardCaret.saveCurrent(),
		canOpen: () => !selectionState.isCrossBlock && window.getSelection()?.isCollapsed !== false,
		canEnter: () => !selectionState.isCrossBlock,
		canOpenCreate: () =>
			!selectionState.isCrossBlock && window.getSelection()?.isCollapsed === false
	});

	function closeMenus(): void {
		blockMenu = null;
		inlineMenu.close();
		linkCard.close();
	}

	// A menu opened in one mode offers that mode's edits, so a mode change closes every menu.
	$effect(() => {
		void effectiveMode;
		untrack(closeMenus);
	});

	// ── Hidden-run class check ──────────────────────────────────────────

	// Once per mode change, so the getComputedStyle cost stays off the keystroke path.
	$effect(() => {
		void effectiveMode;
		if (!editorEl) return;
		const root = editorEl;
		assertInvariant('marker-css-parity', () => checkMarkerCssParity(root));
	});

	// ── Root listeners ──────────────────────────────────────────────────

	// On the resolved scroll container, not the root: in host mode the user scrolls outside the
	// editor, and that scroll must release the block held in place.
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		return installRevealAnchorRelease(target, scrollOwner.release);
	});

	$effect(() => {
		if (!editorEl) return;
		const root = editorEl;
		// focusout bubbles, so reset only when focus leaves the editor's content: for somewhere
		// outside it, or for the host's header, which holds no caret of the editor's.
		return onRoot(root, 'focusout', (e: FocusEvent) => {
			const next = e.relatedTarget as Node | null;
			if (next && root.contains(next) && !isHostChrome(next)) return;
			caretMemory.forget();
		});
	});

	// Its own effect, since it needs no root and would otherwise re-install on every root change.
	$effect(() =>
		onRoot(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				caretMemory.forget();
			}
		})
	);

	$effect(() => {
		if (!editorEl) return;
		return installUndoStepEnd(editorEl, () => controller.endUndoStep());
	});

	// A chord that reaches <body> goes to one editor: the only one, or the last one interacted with.
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

	// The root list as a descent reads it; the window's calls go through arrows because
	// `topWindowing` is declared further down.
	const rootList: ChildList = {
		count: () => doc.children.length,
		refs: blockRefSlots,
		windowing: {
			revealChild: (index) => topWindowing.revealChild(index),
			isInWindow: (index) => topWindowing.isInWindow(index)
		}
	};

	// The component already mounted at `path`, mounting nothing; shared by the rect API and the
	// test hooks.
	function getBlockComponent(path: number[]): BlockComponent | null {
		return componentAt(rootList, path);
	}

	// ── Action Bundles ──────────────────────────────────────────────────

	const scrollOwner = createScrollOwner({
		getScrollHost,
		editorCorrects: ownsScrollCorrection,
		getBlockElByPath,
		getEditorRoot: () => editorEl ?? null,
		isHostScroll: () => hostScroll,
		getClipBounds
	});

	const caretLanding = createCaretLanding({
		getDoc: () => doc,
		root: rootList,
		selectionState,
		caretMemory,
		getBlockElByPath,
		getEditorRoot: () => editorEl ?? null,
		scroll: scrollOwner
	});

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
		caretLanding,
		events,
		reading
	};
	const { blockEdit, focus, history, containerEdit, controller } = createEditorActions(
		editorActionsDeps,
		announceEdit
	);

	// A getter, so block components read the live doc rather than the one they mounted with.
	const getDoc: DocumentGetter = () => doc;

	const decorationEngine = createDecorationEngine({
		getDoc,
		onSourceError: (source, error) =>
			events.emit('error', { origin: 'decoration', error, context: { source } })
	});
	const decorations: DecorationRegistry = { addSource: decorationEngine.addSource };

	const rects = createEditorRects({
		getBlockElByPath,
		getBlockComponent,
		revealPath: (path) => caretLanding.mount(path, { openCollapsed: true }),
		getEditorRoot: () => editorEl ?? null,
		scroll: scrollOwner,
		isCrossBlock: () => selectionState.isCrossBlock,
		isHostChrome,
		landCaretAt: navigateCaret
	});

	const editorId = mintEditorId();

	// The typed-trigger menus (`#tag`, `[[link`); a pick commits as one undo step, like the
	// link card's edits.
	const inlineRange = createInlineRangeCommit({ deps: editorActionsDeps, controller });
	const inlineMenu = createInlineMenuState({
		getDoc,
		getSelection,
		getMode: reading.mode,
		events,
		editorId,
		reading,
		commitRange: (path, start, end, bytes, caretAfter) =>
			inlineRange.commitInlineRange(path, start, end, bytes, caretAfter, { landCaret: true }),
		undoStep: (path, offset, run) => controller.undoStep({ path: docPathFrom(path), offset }, run)
	});
	const inlineMenus: InlineMenuRegistry = inlineMenu.registry;
	$effect(() => () => inlineMenu.dispose());

	const pluginContexts = createEditorPluginContexts({
		editorId,
		getDoc,
		events,
		optionsFor: (name) => pluginEntries?.optionsByName.get(name),
		decorations,
		rects,
		inlineMenus,
		getDocumentGeneration: documentSwap.generation,
		// The one place the mode enters command dispatch, read back through `pluginEditor`.
		getPresentationMode: reading.mode,
		getTheme: () => theme,
		activation: activePlugins,
		// Called at use, never here: both read state declared further down this component.
		insertMarkdown: (md, options) => insertMarkdown(md, options),
		runCommand: (commandId, arg) => runCommand(commandId, arg),
		reading
	});

	// One lookup for every dispatch level, so block, cross-block and root route plugins alike.
	const pluginEditorLookup: PluginEditorLookup = (name) => pluginContexts.get(name);
	const commandErrorSink: CommandErrorSink = (report) => emitCommandError(events, report);

	// onMount, not $effect: plugin callbacks read reactive state, and an effect would tear
	// every subscription down on the first structural edit.
	onMount(() => {
		pluginContexts.attachAll(({ plugin, error }) =>
			events.emit('error', { origin: 'subscriber', error, context: { plugin } })
		);
		return () => pluginContexts.dispose();
	});

	// Aborted on unmount; document-level listeners observe it to cancel mid-operation work.
	const lifetimeController = new AbortController();
	$effect(() => () => {
		// A pending checkpoint timer would otherwise emit for a document that is gone.
		controller.flushDebouncedCheckpoint();
		lifetimeController.abort();
	});

	// Per-instance so two editors on one page never leak load failures into each
	// other's broken-state recompute.
	const brokenImageUrls = new Set<string>();

	const pasteCoordinator = createPasteCoordinator(editorActionsDeps, controller);

	// The document caret while the search bar or link card holds focus; one each, so a card
	// opened over the search bar cannot overwrite the caret the bar restores.
	const searchCaret = createCaretRestore(() => editorEl ?? null);
	const linkCardCaret = createCaretRestore(() => editorEl ?? null);

	const searchReplace = createSearchReplace(editorActionsDeps, controller);
	// Find stays live in reading mode; replace is an edit and does nothing here.
	const searchState = createSearchState({
		getDoc,
		getDocumentGeneration: documentSwap.generation,
		decorations,
		replace: searchReplace,
		// The public scroll call holds the match in place, so a late image decode cannot move it.
		reveal: (p) => rects.scrollTo(p),
		onClose: searchCaret.restore
	});
	// Lives here, not in SearchBar, so the root Ctrl+H and the bar's chevron share it.
	let replaceExpanded = $state(false);

	const reorder = createReorderAction(editorActionsDeps, controller);

	// Cleared first like the reorder announcement, so two headings in a row announce twice.
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

	const crossBlockCommands = createCrossBlockCommands({
		selection: selectionState,
		getDoc,
		controller,
		reading,
		getContentVersion: contentVersion.read
	});

	// Every chord and `runCommand` dispatches against this one context, so all share one history,
	// mode, overrides, range handling and error channel.
	const commands: CommandDispatchContext = {
		history,
		pluginEditor: pluginEditorLookup,
		activation: activePlugins,
		getPresentationMode: reading.mode,
		isCrossBlockRange: () => selectionState.isCrossBlock,
		crossBlockCommands,
		keybindingOverrides: () => overridesMap,
		onCommandError: commandErrorSink,
		reorder
	};

	// One context key per bundle so a container re-provides only what it overrides; history
	// has a single provider (G1.4).
	setContext(BLOCK_EDIT_KEY, blockEdit);
	setContext(FOCUS_KEY, focus);
	setContext(HISTORY_KEY, history);
	setContext(CONTAINER_EDIT_KEY, containerEdit);

	setContext(EDITOR_SERVICES_KEY, {
		events,
		decorations: decorationEngine,
		selection: selectionState,
		rangeCoverage: () => coverage,
		search: searchState,
		caretMemory,
		autoPairs,
		scrollOwner,
		widgetSelection,
		selectedWidget,
		linkCard,
		inlineMenuCombobox: inlineMenu.comboboxFor,
		controller,
		caretLanding,
		pasteCoordinator,
		reorder,
		registryView,
		activePlugins,
		rects,
		commands,
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
		// Accessors, as above.
		get onRunCode() {
			return onRunCode;
		},
		get codeMenuItems() {
			return codeMenuItems;
		},
		brokenImageUrls
	} satisfies EditorPolicies);

	// ── Root DOM effects ────────────────────────────────────────────────

	// `beforeFlip` runs while the outgoing mode still owns the DOM, `afterFlip` once every block
	// has re-rendered; the caret is carried across.
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
		restoreCaret: (path, offset) =>
			caretLanding.restore(caretAt(path, offset), { reveal: 'mount' }),
		holdOutgoingMode: (mode) => {
			outgoingMode = mode;
		}
	});
	$effect.pre(() => {
		const mode = effectiveMode;
		untrack(() => modeFlip.beforeFlip(mode));
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
		land: caretLanding.land,
		getScrollHost,
		getLifetime: () => lifetimeController.signal,
		isHostChrome,
		activateLink,
		linkCard,
		reading,
		widgetSelection
	});
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
		replaceRaw: (index, raw) =>
			replaceBlockRaw({ deps: editorActionsDeps, controller }, [index], raw),
		placeCaretAtPoint,
		insertMarkdown,
		insertCatalogue: getInsertCatalogue,
		activation: activePlugins,
		reading,
		setMenu: (menu) => (blockMenu = menu)
	});

	// Announced for plugins that paint their own colors and cannot see a theme change in CSS.
	// svelte-ignore state_referenced_locally
	let lastTheme = theme;
	$effect(() => {
		const next = theme;
		if (next === lastTheme) return;
		lastTheme = next;
		events.emit('themeChange', next);
	});

	// Hides the native caret and highlight while the overlay paints; keyed on the overlay's own
	// test, so a range it does not paint keeps the native one.
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
			getDoc,
			reading,
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
	// Handles keys for a caret whose block unmounted, when focus has dropped to <body>.
	const editorCrossBlock = createCrossBlockHandlers({
		getEl: () => editorEl ?? null,
		getMyPath: () => selectionState.focus?.path ?? [],
		selection: selectionState,
		getDoc,
		getBlockElByPath,
		caretLanding,
		revealPath: (path) => caretLanding.mount(path),
		getEditorRoot: () => editorEl ?? null,
		getScrollHost,
		scrollOwner,
		getEditorLifetime: () => lifetimeController.signal,
		caretMemory,
		blockEdit,
		controller,
		reading,
		commands,
		pasteCoordinator,
		activePlugins,
		events,
		selectedWidget,
		afterReactivity: () => tick()
	});

	// Every handler checks for this instance: the document listener sees every editor's keys,
	// and one Ctrl+Z must not revert two editors.
	const rootKeydown = createEditorRootKeydown({
		get searchBarEnabled() {
			return searchBar;
		},
		get canReplace() {
			return canReplace;
		},
		get isCrossBlock() {
			return selectionState.isCrossBlock;
		},
		search: searchState,
		commands,
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
	// Copy, cut and paste that Chromium retargets to <body> when the selection has no text position.
	const rootClipboard = createEditorRootClipboard({
		selection: selectionState,
		getDoc,
		crossBlock: editorCrossBlock,
		// An accessor, so the handler reads the live prop.
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

	// The host's font scale against HEIGHT_ESTIMATES; plain `let` because windowing's hottest path
	// reads it and `widthVersion` already signals the rebuild.
	let typeScale = 1;

	// Only font-relative terms scale; getters, so a scale change needs no new height estimator.
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

	// The scroll container's height sets how many blocks mount; a separate counter from
	// `widthVersion`, since a height-only resize keeps every measured height.
	let viewportHeightVersion = $state(0);
	$effect(() => {
		if (!editorEl) return;
		const target = getScrollHost();
		if (!target) return;
		return installViewportHeightWatcher(target, () => viewportHeightVersion++);
	});

	// ── Type scale ──────────────────────────────────────────────────────

	// A font-size change throws every height estimate off, and no other box reports it.
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
		return installHeaderSlotCompensation({ el, scroll: scrollOwner });
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

	// Set after the windowing signals it holds exist; the windowing hook below reads it back.
	setContext(EDITOR_DOC_KEY, {
		doc: getDoc,
		contentVersion: contentVersion.read,
		reading,
		pluginEditor: pluginEditorLookup,
		lifetime: lifetimeController.signal,
		editorRoot: () => editorEl ?? null,
		scrollHost: getScrollHost,
		scrollport: scrollOwner.port,
		blockElLookup: getBlockElByPath,
		focusedPath: focusAttribution.getFocusedPath,
		heightOracle,
		widthVersion: () => widthVersion,
		viewportHeightVersion: () => viewportHeightVersion
	} satisfies EditorDoc);

	// The inner `.block-list`, not `editorEl`: it scrolls with content, so its top maps scrollTop
	// into list coordinates.
	const topWindowing = useContainerWindowing({
		getIndex: () => 0, // ignored: the root has no parent to report to
		getParentPath: () => [],
		getChildren: () => doc.children,
		getChildIds: () => blockIds,
		getListEl: () => editorEl?.querySelector(':scope > .block-list') ?? null,
		provideLeafChannel: true
	});

	// Plain `let`: the scroll correction reads it mid-measure, where the derived would force a
	// layout read (VR-4). It lags one flush when windowing toggles.
	let rootWindowingActive = false;
	$effect(() => {
		rootWindowingActive = topWindowing.window.active;
	});

	// Whether the editor corrects scroll on a height change; in host mode without windowing the
	// browser's scroll anchoring does it instead.
	function ownsScrollCorrection(): boolean {
		return !hostScroll || rootWindowingActive;
	}

	// ── Public API ──────────────────────────────────────────────────────

	export function getSource(): string {
		return serialize(doc);
	}

	// The kind alone, never the node, so a host holds no handle into the tree.
	export function getBlockKindAt(path: number[]): AnyBlockKind | null {
		return blockNodeAt(doc, path)?.kind ?? null;
	}

	/** A snapshot of the current selection with copied paths, or null when nothing is focused. */
	export function getSelection(): EditorSelection | null {
		return readCurrentSelection(selectionState, blockRefs, selectedWidgetCaret);
	}

	function caretAt(path: number[], offset = 0): EditorSelection {
		return { anchor: { path, offset }, focus: { path, offset } };
	}

	// Read off the placed selection, not the requested one: a caret aimed into a hidden body lands
	// on its title row.
	function focusInView(): boolean {
		const focus = getSelection()?.focus;
		return !!focus && scrollOwner.isInView(selectionState.cellLandingFor(focus).path);
	}

	// A navigation: it opens a closed body on the way, and holds the block where it scrolled to so
	// a late image decode can't move it.
	async function navigateCaret(path: number[], offset: number): Promise<boolean> {
		const outcome = await caretLanding.land(
			{ path: docPathFrom(path), offset },
			{ reveal: 'into-view-held', openCollapsed: true }
		);
		return outcome === 'placed' && focusInView();
	}

	/** True only if the selection was placed and its focus block is in view; a programmatic
	 *  scroll before it finishes makes it false, a user scroll does not. */
	export async function setSelection(selection: EditorSelection): Promise<boolean> {
		return (await caretLanding.restore(selection)) === 'applied' && focusInView();
	}

	// The caret search a click on empty space runs, minus the event checks a host has done.
	export function placeCaretAtPoint(x: number, y: number): boolean {
		return editorEl ? rootGestures.placeCaretAtPoint(editorEl, x, y) : false;
	}

	// The entry points below only find the focused editable; the rules live in the editable.
	const focusedSurface = createFocusedSurface({
		get editorEl() {
			return editorEl;
		},
		selection: selectionState,
		getDoc,
		getBlockComponent,
		isReading: () => effectiveMode === 'reading',
		insertParagraph: (boundary, text) => blockEdit.insertParagraph(boundary, text),
		undoStep: (path, offset, run) => controller.undoStep({ path: docPathFrom(path), offset }, run),
		contentVersion: contentVersion.read
	});

	export function insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean> {
		return focusedSurface.insertMarkdown(md, options);
	}

	export function runCommand(commandId: string, arg?: unknown): boolean {
		return runCommandById(commandId as AnyCommandId, arg, focusedSurface.commandTarget(), commands);
	}

	// Asks through `runCommand`'s own dispatch, so a host greys out exactly what a click refuses.
	export function canRunCommand(commandId: string): boolean {
		return canRunCommandById(commandId as AnyCommandId, focusedSurface.commandTarget(), commands);
	}

	// The focused editable reports its toggle state from the bytes the toggle would rewrite.
	export function isCommandActive(commandId: string): boolean {
		return isCommandActiveById(commandId as AnyCommandId, focusedSurface.commandTarget(), commands);
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

	// Recomposed per call: the registries are process-global and not reactive.
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

<!-- tabindex="-1": an unmounted block hands focus here rather than to <body>, and the root
	stays out of the tab order. -->
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
		<!-- A zero-height sticky anchor; portaled out, it takes the theme class instead, since
		     custom properties resolve by DOM ancestry. -->
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
	<!-- One `em` tall and out of flow, so its box reports the root's font size. -->
	<div class="type-scale-probe" bind:this={typeScaleProbeEl} aria-hidden="true"></div>
	{#if header}
		<!-- A sibling of the block list: windowing needs the list as a direct child of the root. -->
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
	<!-- A sibling of the block list, like the header. -->
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
		{inlineRange}
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
		{inlineRange}
		{events}
		{getDoc}
		getEditorEl={() => editorEl ?? null}
		measureRange={rects.rangeRects}
		{activateLink}
		resolveLinkUrl={resolveLinkUrlImpl}
		caretRestore={linkCardCaret}
		{reading}
		{menuPresence}
		{commands}
	/>
	<InlineMenuHost
		menu={inlineMenu}
		{events}
		{menuPresence}
		getEditorEl={() => editorEl ?? null}
		measureRange={rects.rangeRects}
	/>
	<div class="editor-sr-live" role="status" aria-live="polite">{selectionDescription}</div>
	<div class="editor-sr-live-reorder" role="status" aria-live="polite">{editAnnouncement}</div>
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
		/* Wider on the left to hold the drag handle's gutter. */
		padding: 1rem 1rem 1rem 1.5rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		/* Every construct sizes in `em` off this. */
		font-size: var(--editor-font-size, 1rem);
		line-height: 1.6;
		/* Inherit rather than assume a dark host: an unthemed page keeps its own text color. */
		color: var(--color-text-primary, currentColor);
		min-height: 200px;
		overflow-y: auto;
		/* The editor corrects scroll by hand; browser anchoring would correct twice (VR-2). */
		overflow-anchor: none;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border, #3e3e3b) transparent;
		/* Containing block for the image overlay portal. */
		position: relative;
	}

	/* Host scroll: an ancestor scrolls, and without windowing the browser's anchoring holds the
	   position, so it is restored. */
	.editor[data-scroll-mode='host'] {
		overflow-y: visible;
		overflow-anchor: auto;
		min-height: 0;
		flex: none;
		border: none;
		padding: 0;
	}

	/* With windowing on, the editor corrects scroll itself, so its subtree leaves the host's
	   anchor candidates (VR-2). */
	.editor[data-scroll-mode='host'][data-windowing='active'] {
		overflow-anchor: none;
	}

	/* Out of layout, but never `display: none`, which stops a ResizeObserver reporting. */
	.type-scale-probe {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 1em;
		visibility: hidden;
		pointer-events: none;
	}

	.search-anchor {
		position: sticky;
		top: 0;
		height: 0;
		z-index: 5;
	}

	/* Sticky would resolve against the host's scroller and float over unrelated page content. */
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

	/* A nested drag stays inside its container, so the container takes a faint wash, not an
	   outline. */
	:global(.reorder-scope) {
		background: var(--reorder-scope-bg, rgba(100, 150, 255, 0.14));
		border-radius: 4px;
		transition: background-color 0.12s ease;
	}

	/* Fixed, since the rects are client coordinates. */
	.reorder-line {
		position: fixed;
		height: 2px;
		background: var(--md-reorder-indicator);
		border-radius: 2px;
		pointer-events: none;
		z-index: 20;
	}

	/* Replaces the browser's drop caret, which goes with the drop the editor cancels. */
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
