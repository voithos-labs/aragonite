/**
 * Public prop and instance-handle types for <Editor>. Editor.svelte annotates its
 * $props() and its instance methods against these, so neither can drift from the component.
 */
import type { Snippet } from 'svelte';
import type { AnyBlockKind } from './core/nodes';
import type {
	CodeMenuItemsHook,
	PasteImageHook,
	ResolveImageUrl,
	ResolveLinkUrl,
	RunCodeHook
} from './editor-keys';
import type { ImageLoadPolicy } from './core/inline-render';
import type { PresentationMode } from './presentation-mode';
import type { KeybindingOverride } from './schema/keybinding-overrides';
import type { EditorSelection } from './selection/primitives';
import type { EditorEvents } from './editor-events';
import type { SearchState } from './search/search-state.svelte';
import type { DecorationRegistry } from './decorations/types';
import type { EditorRects } from './editor-rects';
import type { EditorPluginEntry } from './schema/plugin-install';
import type { InteractionTraceEntry } from './debug/interaction-trace';

export type { EditorPluginEntry } from './schema/plugin-install';
export type { InteractionTraceEntry } from './debug/interaction-trace';

export interface EditorProps {
	source?: string;
	resolveImageUrl?: ResolveImageUrl;
	resolveLinkUrl?: ResolveLinkUrl;
	imageLoadPolicy?: ImageLoadPolicy;
	onLinkActivate?: (url: string, event: MouseEvent) => void;
	/** Import hook for image-bearing pastes, set once at mount. Each image file is offered
	 *  in order and the markdown returned is inserted at the caret; `null` skips it.
	 *  Installing it takes the whole paste: the clipboard's `text/plain` is not pasted. */
	onPasteImage?: PasteImageHook;
	/** Execution hook for code blocks, set once at mount. The editor runs nothing itself:
	 *  installing this is what puts the run button in a code block's side gutter, and the host
	 *  owns the runtime, the result, and where output goes. Absent, no run button renders. */
	onRunCode?: RunCodeHook;
	/** Overflow-menu hook for code blocks, set once at mount and consulted each time a menu
	 *  opens so items can read live state. Absent, or returning nothing, renders no overflow
	 *  button: the editor has no app-level actions of its own to offer there. */
	codeMenuItems?: CodeMenuItemsHook;
	/** The host's own content, rendered inside the editor's scroll container above the first
	 *  block (a title, properties panel, tag row). It scrolls away with the document rather than
	 *  staying fixed, which is what lets the editor keep its own scroll container and windowing. */
	header?: Snippet;
	/** The block drag handle (default on; reading mode never shows it). Hovering shows it;
	 *  touch, which cannot hover, shows it outright. Only the blocks a user picks up whole have
	 *  one (code, tables, equations, diagrams, pictures, list items, dividers, cards), never
	 *  prose (paragraph, heading, quote, note). `false` removes them, except on a picture, whose
	 *  handle is the only way to move it with a pointer. Keyboard reorder (Alt+Arrow) is always
	 *  available, as is the table's right-click cell menu. */
	blockDragHandles?: boolean;
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
	 *  scroll container. `'host'` lets an ancestor scroll it, and the editor windows against that
	 *  scroller instead, so the mounted set stays O(viewport) either way. The one behavioural
	 *  difference is scroll anchoring; the consumer guide's scrollMode section has the trade. */
	scrollMode?: 'self' | 'host';
	/** Theme name reflected to `data-editor-theme` on the editor root. Built-ins:
	 *  `'dark'` (default) and `'light'`; any other value activates a consumer's
	 *  own `.editor[data-editor-theme='<name>']` token block. The editor paints no
	 *  background, so the name should match the page; an `aragonite-editor-theme`
	 *  wrapper keys its own palette off the same attribute set on the wrapper. */
	theme?: string;
	/** How the document presents, read live like `theme`; `'source'` by default. The consumer
	 *  guide's Presentation modes section describes what each mode shows and allows. */
	presentationMode?: PresentationMode;
	/** Per-instance keymap overrides over the built-in command vocabulary. */
	keybindings?: KeybindingOverride[];
	/** Plugins installed once, in array order, at mount. Set-once: a later change to this
	 *  prop is ignored, because installation is process-global and cannot re-run. An entry
	 *  may be a plugin on its own or `{ plugin, options }` for per-instance options. The
	 *  array also says which plugins are enabled: this editor activates exactly what it
	 *  lists, and no prop at all activates everything installed. */
	plugins?: readonly EditorPluginEntry[];
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
	getSelection(): EditorSelection | null;
	/**
	 * Restore a `getSelection()` snapshot. Async because the target is scrolled into view
	 * first, and true means it got there, not merely that it mounted. Never throws: an
	 * out-of-range offset clamps in that endpoint's own coordinate space (a table
	 * endpoint's row-major cell index clamps to the last cell, not a character position),
	 * and an unresolvable path, or a scroll that never arrives, resolves false.
	 */
	setSelection(selection: EditorSelection): Promise<boolean>;
	/**
	 * Put the caret at a viewport point exactly as a click there would: the point clamps into the
	 * nearest block's box, the block under it decides where the caret goes, and a live cross-block
	 * range ends first. A shell with its own controls beside the document decides whether a click
	 * on its territory comes here; the editor decides where the caret goes. False when no
	 * focusable position resolves. A point below the document resolves against the CST, not the
	 * rendered slice: past an unmounted tail it takes the point and lands there once that mounts.
	 */
	placeCaretAtPoint(x: number, y: number): boolean;
	/**
	 * Insert markdown at the caret exactly as pasting it would, minus the clipboard: paste
	 * transforms, every container-aware strategy, delete-selection-first, one undo entry, and
	 * focus at the end of the insertion. True means the pipeline took the text, not that its
	 * commit has flushed; read the result back through the `edit` event. False, and nothing
	 * mutates, when this editor holds no caret, in reading mode, or at a gap caret.
	 */
	insertMarkdown(md: string): boolean;
	/**
	 * Run a command by id at the focused element, or across a painted range where the id has a
	 * cross-block handler (a format toggle marks every block it touches, a table works by its
	 * cells). False, and nothing mutates, on an unknown id, in reading mode, with nothing focused,
	 * and on the link editor over a range. `arg` reaches the handler as a keybinding's argument
	 * would (`heading.cycle` takes the level, 0 for plain text); a handler that takes none ignores it.
	 */
	runCommand(commandId: string, arg?: unknown): boolean;
	/**
	 * Whether `runCommand(id)` would reach that command's handler right now, asked in the same
	 * place that would run it, so a host can grey a toolbar button out instead of hiding it.
	 * False wherever dispatch declines before it starts: an unknown id, reading mode, a block-local
	 * id with nothing focused (a gap caret included, where only the global ids stay live), and the
	 * link editor while a cross-block range is painted. True means reachable, not successful: the
	 * handler still decides whether it writes, and over a range it may reach no block at all.
	 */
	canRunCommand(commandId: string): boolean;
	/**
	 * Whether the command's toggle reads on where a keypress would land: the read a toolbar paints
	 * its pressed state from, answered by the same bytes the toggle would rewrite. State, not
	 * whether the command is allowed, so a disabled button may still paint pressed. Over a
	 * cross-block range the answer is the range's own coverage: true only where every block it
	 * touches has the mark; the link editor reads on inside the construct its card would edit, in
	 * live mode alone. False for an id with no state of its own, and with nothing focused.
	 */
	isCommandActive(commandId: string): boolean;
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
	/**
	 * Every modifier chord this instance consumes, normalized (`Mod` covers Ctrl and Cmd).
	 * Composed live from the kind keymaps, the command tables, the plugins this editor activated,
	 * the `keybindings` overrides and the search option, so a host's accelerator table is derived,
	 * not hand-copied. Bare keys are outside the contract: a focused document owns them. So is a
	 * chord turned off with `command: null`, free for the host to use app-wide yet still swallowed
	 * inside the editor, where letting the browser handle it would bypass the CST undo stack.
	 */
	reservedChords(): ReadonlySet<string>;
	/** Whether this instance consumes that keystroke, answered with the editor's own chord
	 *  normalization so a host never re-implements the Ctrl-equals-Cmd rule. */
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
}
