/**
 * The editor's options and instance handle, free of Svelte types: `<Editor>`'s props add a
 * snippet `header` to these, and `createEditor`'s add an element one. Editor.svelte annotates its
 * props and methods against these, so neither can drift from the component.
 */
import type { AnyBlockKind } from './core/nodes';
import type {
	CodeMenuItemsHook,
	PasteImageHook,
	ResolveImageUrl,
	ResolveLinkUrl,
	RunCodeHook
} from './host-hooks';
import type { ImageLoadPolicy } from './core/inline-render';
import type { PresentationMode } from './presentation-mode';
import type { LinkClick } from './activation-click';
import type { KeybindingOverride } from './schema/keybinding-overrides';
import type { EditorSelection } from './selection/primitives';
import type { EditorEvents } from './editor-events';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationRegistry } from './decorations/types';
import type { EditorRects } from './editor-rects';
import type { InlineMenuRegistry } from './inline-menu/types';
import type { InsertEntry } from './schema/insert-catalogue';
import type { EditorPluginEntry } from './schema/plugin-install';
import type { SyntaxOptions } from './schema/registry-view';
import type { InteractionTraceEntry } from './debug/interaction-trace';
import type { InputRecordingHandle, InputRecordingOptions } from './debug/input-recorder';

export type { EditorPluginEntry } from './schema/plugin-install';
export type { SyntaxOptions } from './schema/registry-view';
export type { InteractionTraceEntry } from './debug/interaction-trace';
export type { InputRecordingHandle, InputRecordingOptions } from './debug/input-recorder';
export type { InputRecording } from './debug/input-recording';

/** Every editor prop but `header`, whose type depends on how the editor is mounted. */
export interface EditorOptions {
	/** The Markdown the editor mounts with. A later write replaces the document, clearing undo,
	 *  when it differs from `getSource()`, and does nothing when it doesn't or is `undefined`. The
	 *  editor never writes back into it. */
	source?: string;
	resolveImageUrl?: ResolveImageUrl;
	resolveLinkUrl?: ResolveLinkUrl;
	imageLoadPolicy?: ImageLoadPolicy;
	onLinkActivate?: (url: string, event: MouseEvent) => void;
	/** Import hook for image-bearing pastes. Each image file is offered in order and the
	 *  markdown returned is inserted at the caret; `null` skips it. Installing it takes the
	 *  whole paste: the clipboard's `text/plain` is not pasted. */
	onPasteImage?: PasteImageHook;
	/** Execution hook for code blocks. The editor runs nothing itself: installing this is what
	 *  puts the run button in a code block's side gutter, and the host owns the runtime, the
	 *  result, and where output goes. Absent, no run button renders. */
	onRunCode?: RunCodeHook;
	/** Overflow-menu hook for code blocks, consulted each time a menu opens so items can read
	 *  live state. Absent, or returning nothing, renders no overflow button: the editor has no
	 *  app-level actions of its own to offer there. */
	codeMenuItems?: CodeMenuItemsHook;
	/** The block drag handle (default on; never in reading mode), shown on hover, or outright on
	 *  touch. Only blocks a user picks up whole have one (code, tables, equations, diagrams,
	 *  pictures, list items, dividers, cards), never prose. `false` removes them, except on a
	 *  picture, whose handle is its only pointer move. Alt+Arrow reorder always works. */
	blockDragHandles?: boolean;
	/** Faint text an empty block shows until something is typed, read live. A string shows only in
	 *  an empty document, never in reading mode; a function is asked for each empty block on screen
	 *  and returns the text or null. Painted in `--md-placeholder-color` and announced as
	 *  `aria-placeholder`. */
	placeholder?: string | ((block: PlaceholderBlock) => string | null);
	searchBar?: boolean;
	/** The editor's own formatting popover beside a prose selection (default on; reading mode
	 *  never shows it). A host with its own bar over `runCommand` passes false. */
	selectionToolbar?: boolean;
	/** Where the editor's own find/replace bar renders. Absent, it stays fixed inside the editor
	 *  root; an element moves that same bar into it, theme styling included, so an embed that
	 *  scrolls in the host can put it in a pane's own frame instead of mid-page. Read live, and
	 *  ignored while `searchBar` is false. Positioning inside it is the element's own business. */
	searchBarAnchor?: HTMLElement | null;
	/** Who owns the scroll, set once at mount. `'self'` (default) makes the editor root its own
	 *  scroll container, filling the element it sits in; give that element a height, or every block
	 *  stays mounted. `'host'` lets an ancestor scroll it, and the editor windows against that
	 *  scroller instead. The one behavioural difference is scroll anchoring; the consumer guide's
	 *  scrollMode section has the trade. */
	scrollMode?: 'self' | 'host';
	/** Theme name reflected to `data-editor-theme` on the editor root. Built-ins:
	 *  `'dark'` (default) and `'light'`; any other value activates a consumer's
	 *  own `.editor[data-editor-theme='<name>']` token block. The editor paints no
	 *  background, so the name should match the page; a host color the page leaves
	 *  undeclared takes this theme's built-in value. */
	theme?: string;
	/** Who draws the caret, read live; only a drawn one shows the format the next letter will get.
	 *  `'auto'` (default) draws on a fine pointer and leaves a touch screen the browser's own;
	 *  `'drawn'` draws on any pointer; `'native'` keeps the browser's wherever it can draw one (the
	 *  editor still draws beside a widget, at a gap and at a code chip's edge). Forced colors keep
	 *  the browser's. The selection stays the browser's, so IME and screen readers don't change. */
	caret?: 'auto' | 'native' | 'drawn';
	/** How the document presents, read live like `theme`; `'source'` by default. The consumer
	 *  guide's Presentation modes section describes what each mode shows and allows. */
	presentationMode?: PresentationMode;
	/** Which click follows a link, or a widget that goes somewhere, in live mode, read live:
	 *  `'modifier'` (default) is Ctrl/Cmd-click, and `'plain'` any click, as on a web page, with a
	 *  link edited by the arrow keys, Mod+K or its "Edit link" menu row. Reading mode follows any
	 *  click; source and preview modes, which show a link's syntax, keep Ctrl/Cmd. */
	linkClick?: LinkClick;
	/** Per-instance keymap overrides over the built-in command vocabulary. */
	keybindings?: KeybindingOverride[];
	/** Plugins installed once, in array order, at mount. Set-once: a later change to this
	 *  prop is ignored, because installation is process-global and cannot re-run. An entry
	 *  may be a plugin on its own or `{ plugin, options }` for per-instance options. The
	 *  array also says which plugins are enabled: this editor activates exactly what it
	 *  lists, and no prop at all activates everything installed. */
	plugins?: readonly EditorPluginEntry[];
	/** GFM syntaxes to switch off in this editor, each on by default and read once at mount:
	 *  `indentedCode: false` reads a line indented by a tab or four spaces as prose, and
	 *  `setextHeading: false` reads `===` or `---` under text as prose or a divider. Only the
	 *  reading changes: a loaded file keeps every byte, and saves as it came. */
	syntax?: SyntaxOptions;
}

/** When a prop's new value takes effect: `live` at once (a hook is called as it stands at each
 *  use), `once` never, since it is read at mount. */
export type PropTiming = 'live' | 'once';

/** What a wrapper needs to know about one option. `boolean` marks the options typed `boolean`,
 *  which a wrapper like Vue must declare with no default so an absent one keeps the editor's. */
export type EditorOptionSpec<T> = [NonNullable<T>] extends [boolean]
	? { readonly timing: PropTiming; readonly boolean: true }
	: { readonly timing: PropTiming; readonly boolean?: never };

/** One spec for every key of `P`, optional keys included. */
export type EditorOptionSpecs<P = EditorOptions & { header?: unknown }> = {
	readonly [K in keyof Required<P>]: EditorOptionSpec<P[K]>;
};

/**
 * Every editor option, `header` included, with when a new value takes effect and whether it's a
 * boolean. `createEditor` skips the `once` options on `update`, and a framework wrapper declares
 * its props from this list.
 */
export const EDITOR_OPTION_SPECS = {
	source: { timing: 'live' },
	theme: { timing: 'live' },
	presentationMode: { timing: 'live' },
	linkClick: { timing: 'live' },
	caret: { timing: 'live' },
	keybindings: { timing: 'live' },
	placeholder: { timing: 'live' },
	searchBar: { timing: 'live', boolean: true },
	searchBarAnchor: { timing: 'live' },
	selectionToolbar: { timing: 'live', boolean: true },
	blockDragHandles: { timing: 'live', boolean: true },
	imageLoadPolicy: { timing: 'live' },
	header: { timing: 'live' },
	resolveImageUrl: { timing: 'live' },
	resolveLinkUrl: { timing: 'live' },
	onLinkActivate: { timing: 'live' },
	onPasteImage: { timing: 'live' },
	onRunCode: { timing: 'live' },
	codeMenuItems: { timing: 'live' },
	plugins: { timing: 'once' },
	syntax: { timing: 'once' },
	scrollMode: { timing: 'once' }
} as const satisfies EditorOptionSpecs;

/** The empty block a function `placeholder` is asked about. */
export interface PlaceholderBlock {
	kind: string;
	/** Child indices from the document root. */
	path: number[];
	/** The whole document is this one empty block. */
	documentEmpty: boolean;
	/** The caret is in this block. */
	focused: boolean;
	/** False in reading mode. */
	editable: boolean;
}

export interface InsertMarkdownOptions {
	/** `caret` (the default) inserts where the caret is; `below` inserts into a new paragraph
	 *  after the top-level block that holds it. */
	placement?: 'caret' | 'below';
}

/** The `bind:this` handle a consumer can name and hold a ref to. */
export interface EditorInstance {
	getSource(): string;
	/**
	 * The block kind at `path` (child indices from the document root), or null when the path
	 * addresses no block: an out-of-range index, and the empty root path, which is the document
	 * itself. A read, not a handle: the node stays inside the editor. A plugin block answers its
	 * own declared kind name.
	 */
	getBlockKindAt(path: number[]): AnyBlockKind | null;
	/**
	 * The live selection, or null when nothing is focused. While an image is selected whole it is
	 * a caret at the image's edge its selection came from (its end after a click). Reading mode
	 * has no caret, so there it's null unless a range is selected.
	 */
	getSelection(): EditorSelection | null;
	/**
	 * Restore a `getSelection()` snapshot. Async because the target is scrolled into view first,
	 * and true means it got there, not merely that it mounted. Never throws: an out-of-range
	 * offset clamps in its own coordinate space, and an unresolvable path, or a scroll that never
	 * arrives, resolves false. A caret at a list's start lands in its first item, one inside a
	 * closed body on its title row, and in reading mode one lands as focus on its block.
	 */
	setSelection(selection: EditorSelection): Promise<boolean>;
	/**
	 * Put the caret at a viewport point exactly as a click there would: the point clamps into the
	 * nearest block's box, the block under it picks the spot, and a live cross-block range ends
	 * first, and in reading mode the block takes focus instead. A host decides which of its clicks
	 * come here. False when no focusable position resolves; a point past an unmounted tail lands
	 * there once that mounts.
	 */
	placeCaretAtPoint(x: number, y: number): boolean;
	/**
	 * Insert markdown exactly as pasting it would, minus the clipboard: paste transforms,
	 * delete-selection-first, one undo entry, focus at the end. Resolves true once the insert has
	 * landed; false, with nothing changed, with no caret, in reading mode, or at a gap caret.
	 * `placement: 'below'` first adds an empty paragraph after the caret's top-level block.
	 */
	insertMarkdown(md: string, options?: InsertMarkdownOptions): Promise<boolean>;
	/**
	 * Run a command by id at the focused element, or across a painted range where the id has a
	 * cross-block handler (a format toggle marks every block it touches, a table works by its
	 * cells). False, and nothing mutates, on an unknown id, in reading mode, with nothing focused,
	 * and on the link editor over a range. `arg` reaches the handler as a keybinding's argument
	 * would (`heading.cycle` takes the level, 0 for plain text); a handler that takes none ignores it.
	 */
	runCommand(commandId: string, arg?: unknown): boolean;
	/**
	 * Whether `runCommand(id)` would reach that command's handler right now, so a host can grey a
	 * toolbar button out instead of hiding it. False wherever dispatch declines before it starts
	 * (an unknown id, reading mode, a block-local id with nothing focused, the link editor over a
	 * cross-block range), and for undo or redo with nothing to undo or redo, which `runCommand`
	 * still takes. True means reachable, not successful: the handler decides whether it writes.
	 */
	canRunCommand(commandId: string): boolean;
	/**
	 * Whether the command's toggle reads on where a keypress would land: a toolbar's pressed
	 * state, from the same bytes the toggle would rewrite. State, not permission, so a disabled
	 * button may still paint pressed. Over a cross-block range, true only where every touched block
	 * has the mark. False for an id with no state, and with nothing focused.
	 */
	isCommandActive(commandId: string): boolean;
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	/** The same registry a plugin reaches as `editor.inlineMenus`, for a host that owns the menu's
	 *  data (its document index, its tag list) rather than shipping a plugin for it. */
	getInlineMenus(): InlineMenuRegistry;
	/**
	 * The blocks the insert menus offer, in menu order: the built-ins, then each block a plugin this
	 * editor activated registered. The list the right-click flyout draws, for a host building its own
	 * insert button; each entry's `markdown` is what to hand `insertMarkdown`. A fresh frozen list per call.
	 */
	getInsertCatalogue(): readonly InsertEntry[];
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
	/**
	 * Every modifier chord this instance takes somewhere, normalized (`Mod` covers Ctrl and Cmd): the
	 * union over every block kind, composed live from the keymaps, active plugins, `keybindings` and
	 * search, for a host's accelerator table. Bare keys aren't listed, nor is a chord turned off with
	 * `command: null`. For the keystroke in hand, ask `claimsChord`.
	 */
	reservedChords(): ReadonlySet<string>;
	/**
	 * Whether this instance takes that keystroke where it lands, bare or chorded: the target block's
	 * keymap and its containers', the global chords, and the keys a block edits or moves through
	 * itself. Read off the event's target, or focus for an event never dispatched; `false` with focus
	 * outside the editor. Ctrl and Cmd read alike.
	 */
	claimsChord(event: KeyboardEvent): boolean;
}

/**
 * Diagnostics for a bug report: turn the interaction trace on, read it, and serialize a
 * report a user can attach. Recording is off by default, so a consumer opts in, reproduces
 * the problem, then serializes. The trace is process-global: two instances interleave entries.
 */
export interface EditorDiagnostics {
	enableTrace(): void;
	disableTrace(): void;
	isTraceEnabled(): boolean;
	traceSnapshot(): InteractionTraceEntry[];
	/**
	 * A fenced-markdown snapshot (timestamp, trace tail, ops-log tail, selection). The
	 * document source is left out by default; pass `{ includeSource: true }` to opt in.
	 */
	serializeDiagnostics(opts?: { includeSource?: boolean }): string;
	/**
	 * Records this editor's input until `stop()`, which returns the recording as JSON-ready data:
	 * each step's events, bytes hash and selection. Text (typed characters, key codes, event data,
	 * clipboard and DOM text) is left out unless `includeText` is set. The format is a diagnostics
	 * file, not a stable contract before 1.0. Recordings run independently of each other.
	 */
	recordInput(options?: InputRecordingOptions): InputRecordingHandle;
}
