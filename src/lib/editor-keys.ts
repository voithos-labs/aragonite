/**
 * Svelte context-key symbols shared across the editor tree: three named facets
 * (services, policies, document) plus the keys that must stay separate: the action
 * triple a container re-provides, the history key (only the editor root provides it,
 * G1.4), and the channels a block list provides to its children. Internal wiring, not a
 * plugin extension point; a facet object is not itself reactive, but the getters on it are.
 */

import type { MenuPresence } from './components/menu/menu-presence.svelte';
import type { Document } from './core/nodes';
import type { ImageLoadPolicy } from './core/inline-render';
import type { UserScrollport } from './cursor/scroll-ancestors';
import type { Scrollport } from './cursor/scrollport';
import type { PresentationMode } from './presentation-mode';
import type { KeybindingOverrideMap } from './schema/keybinding-overrides';
import type { EditorContext } from './schema/plugin-install';
import type { RegistryView } from './schema/registry-view';
import type { Reading } from './schema/reading';
import type { PluginActivation } from './schema/plugin-activation';
import type { CrossBlockCommandRouter } from './schema/block-commands';
import type { EditorRects } from './editor-rects';
import type { EditorEvents } from './editor-events';
import type { UndoController } from './editor-actions/deps';
import type { ReorderAction } from './editor-actions/reorder-action';
import type { PasteCommitCoordinator } from './tree-operations/paste/paste-deps';
import type { SelectionState } from './selection/selection-state.svelte';
import type { SelectedWidgetHandle } from './selection/primitives';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationEngine } from './decorations/decoration-state.svelte';
import type { StickyColumnState } from './cursor/sticky-column';
import type { EdgeAffinityState } from './cursor/edge-affinity';
import type { PendingMarksState } from './cursor/pending-marks';
import type { AutoPairRecord } from './components/blocks/text/auto-pair-record';
import type { RevealAnchorState } from './cursor/reveal-anchor';
import type { HeightOracle } from './cursor/height-oracle';
import type { InlineMenuCombobox } from './inline-menu/inline-menu-state.svelte';
import type { WidgetSelectionState } from './components/image/widget-selection-state.svelte';
import type { LinkCardState } from './components/link-card/link-card-state.svelte';
import type { KindCue } from './components/kind-cue.svelte';

// ── Shared value-shape types ─────────────────────────────────────────────────

export type ReorderAnnounce = (message: string) => void;
export type KeybindingOverridesGetter = () => KeybindingOverrideMap;
export type ResolveImageUrl = (rawUrl: string) => string;
export type ResolveLinkUrl = (rawUrl: string) => string;

/** One image file lifted off an image-bearing paste, handed to the host's import
 *  hook. `suggestedName` is the clipboard's filename when it carried one. */
export interface PastedImage {
	blob: Blob;
	mimeType: string;
	suggestedName?: string;
}

/** Host import hook for pasted images: resolves to the markdown to insert, or null
 *  to skip that image. Called once per image file, in clipboard order. */
export type PasteImageHook = (image: PastedImage) => Promise<string | null>;

/** What a code block hands its host when the run button is pressed. */
export interface CodeRunRequest {
	/** The fence body alone; the opener and closer lines are left out. */
	code: string;
	/** The opener's full info string, untrimmed of trailing attributes (`py {1-3}`). */
	info: string;
	/** Child indices from the document root to this block. */
	path: number[];
}

/**
 * Host hook for executing a code block. The editor runs nothing itself: installing this is
 * what puts the run button in the block's side gutter, and the host owns everything after,
 * the runtime, the result, and where output goes. Absent, no run button renders.
 */
export type RunCodeHook = (request: CodeRunRequest) => void;

/** One entry in a code block's overflow menu. `run` is called with the menu already closed. */
export interface CodeMenuItem {
	id: string;
	label: string;
	run: () => void;
	/** Renders dimmed and refuses activation. */
	disabled?: boolean;
}

/**
 * Host hook for the code block's overflow menu, consulted each time the menu opens so the
 * items can read live state. Absent, or returning nothing, renders no overflow button:
 * the editor has no app-level actions of its own to put there.
 */
export type CodeMenuItemsHook = (request: CodeRunRequest) => readonly CodeMenuItem[];

export type PresentationModeGetter = () => PresentationMode;
/** The editor's theme name, as reflected to `data-editor-theme`. An open string:
 *  built-ins are `'dark'`/`'light'`, and a consumer may name its own. */
export type ThemeGetter = () => string;
/** `undefined` for a plugin installed in the process that this instance did not activate. */
export type PluginEditorLookup = (pluginName: string) => EditorContext | undefined;
export type BlockElLookup = (path: number[]) => HTMLElement | null;
export type DocumentGetter = () => Document;
export type FocusedPathGetter = () => number[] | null;
export type VersionGetter = () => number;

// ── Action triple (per-key: containers re-provide these three) ───────────────

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

/** Only the editor root provides history, so undo and redo resolve to one stack (G1.4).
 *  Putting it in a facet a container could re-provide is exactly the violation. */
export const HISTORY_KEY = Symbol('history-actions');

// ── Channels a block list provides to its children ───────────────────────────

export const LIST_CONTEXT_KEY = Symbol('list-context');
export const TABLE_CONTEXT_KEY = Symbol('table-context');

/**
 * @internal A block signs up for its block list's batched measure pass. `register` does
 * nothing when the path is not a direct child at that list's depth (a nested list has its
 * own channel); `readHeight` runs inside the list's read-everything-then-write batch, never
 * on its own. `measureOnResize` passes the observer's border-box height, so the list can
 * check in O(1) and skip the resize a mount fires for nothing.
 */
export const RECORD_BLOCK_HEIGHT_KEY = Symbol('record-block-height');
export type BlockMeasureChannel = {
	register: (path: number[], index: number, id: string, readHeight: () => number) => () => void;
	measureNow: (id: string) => void;
	measureOnResize: (id: string, observedHeight: number) => void;
};

/**
 * @internal A child reports up to the block list above it: a nested container pushes its box
 * subtotal by index, while a `display:contents` row, which has no box of its own, signs up
 * for the batched measure pass instead, so a windowed table measures like every other list.
 */
export const PARENT_SCOPE_SINK_KEY = Symbol('parent-scope-sink');
export type ParentScopeSink = {
	setChildSubtotal: (index: number, total: number) => void;
	registerRow: (
		id: string,
		readHeight: () => number,
		applyHeight: (h: number) => void
	) => () => void;
	measureRowNow: (id: string) => void;
};

// ── Facets ───────────────────────────────────────────────────────────────────

/** Cross-cutting editor services: the event dispatcher, the view-state stores, and the
 *  commit and reorder calls that work across block lists. Provided once by the root. */
export const EDITOR_SERVICES_KEY = Symbol('editor-services');
export interface EditorServices {
	events: EditorEvents;
	decorations: DecorationEngine;
	selection: SelectionState;
	search: SearchState;
	stickyColumn: StickyColumnState;
	/** Which side of an adjacent run of hidden markers the caret means; the code that writes
	 *  bytes reads it and keeps its own default when the answer is null. */
	edgeAffinity: EdgeAffinityState;
	/** The constructs a toggle with no selection promised the next insertion. Dropped along
	 *  with the edge affinity, and used up where typed and composed text is written. */
	pendingMarks: PendingMarksState;
	/** The empty delimiter pair the auto-pair last wrote, the only pair it steps over, collapses
	 *  or deletes; each typing block takes its own view of it. */
	autoPairs: AutoPairRecord;
	revealAnchor: RevealAnchorState;
	widgetSelection: WidgetSelectionState;
	/** The image `widgetSelection` holds, as a raw span read from the live document. */
	selectedWidget: SelectedWidgetHandle;
	/** Which link the live-mode card is editing; `link.openCard` opens it from a kind's keymap. */
	linkCard: LinkCardState;
	/** What the editable at `path` says about the inline menu's list while one shows in it, or
	 *  null. The block renders the attributes itself, rather than the list reaching in. */
	inlineMenuCombobox: (path: readonly number[]) => InlineMenuCombobox | null;
	controller: UndoController;
	pasteCoordinator: PasteCommitCoordinator;
	reorder: ReorderAction;
	reorderAnnounce: ReorderAnnounce;
	/** This instance's view of the global block definitions, so a per-instance list of
	 *  enabled kinds reaches the render path. */
	registryView: RegistryView;
	/** The plugins this instance activated, so a paste narrows the transform pipeline the
	 *  way `registryView` narrows the kinds. */
	activePlugins: PluginActivation;
	/** The instance's `EditorRects`, handed to every block component as a prop so a block can
	 *  measure, scroll into view, or scroll to a path through one entry point. */
	rects: EditorRects;
	/** The branch a format command takes while a cross-block range is painted, threaded into
	 *  every dispatch check so the chord, the per-kind rebinding and `runCommand` share it. */
	crossBlockCommands: CrossBlockCommandRouter;
	/** How many editor menus are showing; a block's own menu attaches `track` to its root. */
	menuPresence: MenuPresence;
	/** The label a typed kind change leaves on its block for a moment (`kind-cue.svelte.ts`). */
	kindCue: KindCue;
}

/** Host-supplied render/behavior policies. The getter members read live editor state
 *  on each call. */
export const EDITOR_POLICIES_KEY = Symbol('editor-policies');
export interface EditorPolicies {
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	imageLoadPolicy: () => ImageLoadPolicy;
	/** Getter-wrapped set-once flag: render the mouse-only hover controls, the block drag
	 *  handle and the table's handles. False renders neither; the keyboard paths stay. */
	blockDragHandles: () => boolean;
	presentationMode: PresentationModeGetter;
	/** For a renderer that paints rather than styles: a plugin emitting its own colored
	 *  markup (a diagram SVG) cannot pick the theme up from CSS, so it needs the name. */
	theme: ThemeGetter;
	keybindingOverrides: KeybindingOverridesGetter;
	/** Set-once host import hook for image-bearing pastes. Required-nullable: a mount must
	 *  answer, and `undefined` deliberately leaves the paste on the plain-text path. */
	onPasteImage: PasteImageHook | undefined;
	/** Set-once host execution hook; its presence is what renders the run button. */
	onRunCode: RunCodeHook | undefined;
	/** Set-once host menu hook; its presence is what renders the overflow button. */
	codeMenuItems: CodeMenuItemsHook | undefined;
	/** Resolved image URLs that failed to load this session. One Set per instance, so a
	 *  failed load never suppresses another editor's broken-state recompute
	 *  (`components/image/widget-dom.ts`). */
	brokenImageUrls: Set<string>;
}

/** Document identity and the per-instance lookups that hang off it. */
export const EDITOR_DOC_KEY = Symbol('editor-doc');
export interface EditorDoc {
	doc: DocumentGetter;
	/** Changes whenever the document's bytes change: the only sound memo key over a
	 *  document whose `$state` proxy is mutated in place and never changes identity. */
	contentVersion: () => number;
	/** How this editor reads its bytes: grammar, link definitions, mode. */
	reading: Reading;
	/** Resolves a plugin's per-instance `EditorContext`: the one object `onEditor` callbacks,
	 *  global-command handlers and `BlockCommandContext.editor` all share. */
	pluginEditor: PluginEditorLookup;
	/** AbortSignal tied to the editor's mount lifetime; document-level listeners
	 *  observe it to tear down if the editor unmounts mid-operation. */
	lifetime: AbortSignal;
	editorRoot: () => HTMLElement | null;
	/** What a drag autoscrolls to reach more of this editor: the editor root in self mode,
	 *  the nearest ancestor the user can scroll in host mode, null when the page's own
	 *  viewport scrolls. Which element bounds the visible region is a separate answer, held
	 *  by `EditorRects`; see `cursor/scroll-ancestors`. */
	scrollHost: () => UserScrollport | null;
	/** The same scroller as `scrollHost`, in the shape windowing measures and writes it
	 *  through. Null only before the root mounts. */
	scrollport: () => Scrollport | null;
	blockElLookup: BlockElLookup;
	/** Live getter for the focused block's full path; it decides which block each level of
	 *  windowing holds in place. */
	focusedPath: FocusedPathGetter;
	/** Per-kind height estimator, built by the root and read by nested block lists. */
	heightOracle: HeightOracle;
	/** True while the editor holds the user's place through a height change rather than
	 *  leaving it to the browser's own scroll anchoring. The `overflow-anchor` opt-out reads
	 *  the same fact, so the two can never both write one scroll position. */
	correctsScroll: () => boolean;
	/** Counter the root bumps on an editor width resize, so every block list rebuilds its
	 *  height table and re-measures at the new width. */
	widthVersion: VersionGetter;
	/** Counter the root bumps when the scroll container's height changes. Its own
	 *  signal, never `widthVersion`: a height resize re-wraps no prose, so bumping the
	 *  width counter would drop every measured height for nothing. */
	viewportHeightVersion: VersionGetter;
}
