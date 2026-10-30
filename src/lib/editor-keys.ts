/**
 * Svelte context-key symbols shared across the editor tree: three named facets (services,
 * policies, document) plus the keys that stay separate: the action triple a container re-provides,
 * the history key only the root provides (G1.4), and the channels a block list gives its children.
 * Internal wiring, not a plugin extension point; a facet object is not reactive, its getters are.
 */

import type { MenuPresence } from './components/menu/menu-presence.svelte';
import type { DraftRegistry } from './components/draft-registry';
import type { ShownSourceState } from './components/blocks/text/shown-source.svelte';
import type { DocumentStamps } from './editor-actions/commit/document-stamp';
import type { Document } from './core/nodes';
import type { ImageLoadPolicy } from './core/inline-render';
import type { UserScrollport } from './windowing/scroll-ancestors';
import type { ScrollportReader } from './windowing/scrollport';
import type { ActivationClick, PressTracker } from './activation-click';
import type { EditorContext } from './schema/plugin-install';
import type { RegistryView } from './schema/registry-view';
import type { Reading } from './schema/reading';
import type { PluginActivation } from './schema/plugin-activation';
import type { CommandDispatchContext } from './schema/block-commands';
import type { EditorRects } from './editor-rects';
import type { EditorEvents } from './editor-events';
import type { UndoController } from './editor-actions/deps';
import type { ReorderAction } from './editor-actions/reorder-action';
import type { PasteCommitCoordinator } from './tree-operations/paste/paste-deps';
import type { SelectionState } from './selection/selection-state.svelte';
import type { CaretLanding } from './selection/caret-landing';
import type { RangeCoverage } from './selection/range-coverage';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationEngine } from './decorations/decoration-state.svelte';
import type { CaretMemory } from './caret/caret-memory';
import type { CaretWriter } from './browser/caret-writer';
import type { CompositionTracker } from './browser/composition';
import type { DrawnCaret } from './caret/drawn-caret.svelte';
import type { AutoPairRecord } from './components/blocks/text/auto-pair-record';
import type { ScrollOwner } from './windowing/scroll-owner';
import type { HeightOracle } from './windowing/height-estimator';
import type { ListTree } from './windowing/list-tree';
import type { InlineMenuCombobox } from './inline-menu/inline-menu-state.svelte';
import type { LinkCardState } from './components/link-card/link-card-state.svelte';
import type { KindCue } from './components/kind-cue.svelte';
import type { TextMoves } from './components/overlays/text-moves';
import type { ContainerChords } from './editor-actions/container-chords';
import type { ReadingFocus } from './components/editor-root/reading-focus.svelte';
import type { PlaceholderPolicy } from './components/blocks/placeholder-hint.svelte';
import type { BlockElLookup } from './caret/block-el-lookup';
import type {
	CodeMenuItemsHook,
	PasteImageHook,
	ResolveImageUrl,
	ResolveLinkUrl,
	RunCodeHook
} from './host-hooks';

// ── Shared value-shape types ─────────────────────────────────────────────────

/** The editor's theme name, as reflected to `data-editor-theme`. An open string:
 *  built-ins are `'dark'`/`'light'`, and a consumer may name its own. */
export type ThemeGetter = () => string;
/** `undefined` for a plugin installed in the process that this instance did not activate. */
export type PluginEditorLookup = (pluginName: string) => EditorContext | undefined;
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

/** @internal How a windowed child's height reaches its own block list's height table. */
export const CHILD_MEASURE_KEY = Symbol('child-measure');
/** Only `useMeasuredChild` calls it; `path` is the child's own, so its last index is its place. */
export interface ChildMeasureChannel {
	register(path: readonly number[], id: string, readHeight: () => number): () => void;
	measureNow(id: string): void;
	measureOnResize(id: string, observedHeight: number): void;
	/** Every child's size is watched by one observer per editor; its callback only records heights. */
	watchSize(el: Element, onHeight: (height: number) => void): () => void;
}

// ── Facets ───────────────────────────────────────────────────────────────────

/** Cross-cutting editor services: the event dispatcher, the view-state stores, and the
 *  commit and reorder calls that work across block lists. Provided once by the root. */
export const EDITOR_SERVICES_KEY = Symbol('editor-services');
export interface EditorServices {
	events: EditorEvents;
	decorations: DecorationEngine;
	/** The selection the editor owns (a range, a gap caret or a widget selected whole), which
	 *  every reader of a selected widget asks. */
	selection: SelectionState;
	/** What the live range covers, read once per selection change so every overlay paints the
	 *  answer the delete and the copy read; null with no range. */
	rangeCoverage: () => RangeCoverage | null;
	search: SearchState;
	/** How the caret arrived: the sticky column, the side of a hidden marker run and the
	 *  pending marks, kept and dropped as one. */
	caretMemory: CaretMemory;
	/** The one writer of the native selection; each write asks the drawn caret to repaint. */
	caretWriter: CaretWriter;
	/** Where each press in the editor went down: the one answer to whether a release ended a drag. */
	presses: PressTracker;
	/** The caret the editor draws; each editable surface registers itself with it. */
	drawnCaret: DrawnCaret;
	/** The composition in progress, whichever element hosts it; the one composing flag. */
	composition: CompositionTracker;
	/** The empty delimiter pair the auto-pair last wrote, the only pair it steps over, collapses
	 *  or deletes; each typing block takes its own view of it. */
	autoPairs: AutoPairRecord;
	/** The one writer of the scroll position; every scroll a module wants goes through it. */
	scrollOwner: ScrollOwner;
	/** Which link the live-mode card is editing; `link.openCard` opens it from a kind's keymap. */
	linkCard: LinkCardState;
	/** What the editable at `path` says about the inline menu's list while one shows in it, or
	 *  null. The block renders the attributes itself, rather than the list reaching in. */
	inlineMenuCombobox: (path: readonly number[]) => InlineMenuCombobox | null;
	controller: UndoController;
	/** Where the caret is put down after an edit, and the mount a cross-block key lands through. */
	caretLanding: CaretLanding;
	pasteCoordinator: PasteCommitCoordinator;
	reorder: ReorderAction;
	/** This instance's view of the global block definitions, so a per-instance list of
	 *  enabled kinds reaches the render path. */
	registryView: RegistryView;
	/** The plugins this instance activated, so a paste narrows the transform pipeline the
	 *  way `registryView` narrows the kinds. */
	activePlugins: PluginActivation;
	/** The instance's `EditorRects`, handed to every block component as a prop so a block can
	 *  measure, scroll into view, or scroll to a path through one entry point. */
	rects: EditorRects;
	/** What every chord and `runCommand` in this editor dispatches against: one history, one set
	 *  of overrides, one error channel. */
	commands: CommandDispatchContext;
	/** How many editor menus are showing; a block's own menu attaches `track` to its root. */
	menuPresence: MenuPresence;
	/** Edits held outside the document until they commit; a swap drops them (`draft-registry.ts`). */
	drafts: DraftRegistry;
	/** The one inline widget showing its source in this editor, which its block draws as bytes. */
	shownSource: ShownSourceState;
	/** Which document each write was made for; `BlockHost` stamps its block's write handles. */
	stamps: DocumentStamps;
	/** The label a typed kind change leaves on its block for a moment (`kind-cue.svelte.ts`). */
	kindCue: KindCue;
	/** Where a change that moves text without resizing its block is reported, so the overlays
	 *  over that text measure again. */
	textMoves: TextMoves;
	/** The editor's one tab stop in reading mode; each block's focus element takes its tabindex
	 *  from it. */
	readingFocus: ReadingFocus;
	/** The chords the containers around a block take, which each block's keydown runs last. */
	containerChords: ContainerChords;
}

/** Host-supplied render/behavior policies. The getter members read live editor state
 *  on each call. */
export const EDITOR_POLICIES_KEY = Symbol('editor-policies');
export interface EditorPolicies {
	resolveImageUrl: ResolveImageUrl;
	resolveLinkUrl: ResolveLinkUrl;
	imageLoadPolicy: () => ImageLoadPolicy;
	/** Read live, so a prop change reaches built blocks: render the mouse-only hover controls,
	 *  the block drag handle and the table's handles. False renders neither; keyboard stays. */
	blockDragHandles: () => boolean;
	/** Read live, so a prop change repaints built blocks: the `placeholder` prop and whether the
	 *  document is one top-level block, or null while the prop is unset. */
	placeholder: () => PlaceholderPolicy | null;
	/** For a renderer that paints rather than styles: a plugin emitting its own colored
	 *  markup (a diagram SVG) cannot pick the theme up from CSS, so it needs the name. */
	theme: ThemeGetter;
	/** Whether a click follows what it lands on (a link, a widget that goes somewhere): the one
	 *  answer every such route reads, with the mode and the `linkClick` prop read at the click. */
	activationClick: ActivationClick;
	/** The host's hooks, read at each use so a swapped or added one reaches built blocks.
	 *  Undefined leaves an image paste on the plain-text path and renders no run or menu button. */
	onPasteImage: () => PasteImageHook | undefined;
	onRunCode: () => RunCodeHook | undefined;
	codeMenuItems: () => CodeMenuItemsHook | undefined;
	/** Resolved image URLs that failed to load this session, one Set per instance so a failure never
	 *  suppresses another editor's broken-state recompute. */
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
	/** What a drag autoscrolls: the editor root in self mode, the nearest scrollable ancestor in host
	 *  mode, null when the page scrolls. `EditorRects` answers what bounds the visible region. */
	scrollHost: () => UserScrollport | null;
	/** The same scroller as `scrollHost`, read-only, in the shape windowing measures it through.
	 *  Null only before the root mounts; `EditorServices.scrollOwner` writes it. */
	scrollport: () => ScrollportReader | null;
	blockElLookup: BlockElLookup;
	/** Live getter for the focused block's full path; it decides which block each level of
	 *  windowing holds in place. */
	focusedPath: FocusedPathGetter;
	/** Per-kind height estimator, built by the root and read by nested block lists. */
	heightOracle: HeightOracle;
	/** Every mounted block list, which the scroll owner reads the document's heights through. */
	listTree: ListTree;
	/** Counter the root bumps on an editor width resize, so every block list rebuilds its
	 *  height table and re-measures at the new width. */
	widthVersion: VersionGetter;
	/** Bumped when the scroll container's height changes, apart from `widthVersion`: a height change
	 *  re-wraps no prose, so it must not drop every measured height. */
	viewportHeightVersion: VersionGetter;
}
