/**
 * Public prop and instance-handle types for <Editor>. Editor.svelte annotates its
 * $props() and instance surface against these, so neither can drift from the component.
 */
import type { Snippet } from 'svelte';
import type { PasteImageHook, ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
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
	 *  Installing it takes the WHOLE paste — the clipboard's `text/plain` is not pasted. */
	onPasteImage?: PasteImageHook;
	/** Host chrome rendered INSIDE the editor's scroll container, above the first block
	 *  (a title, properties panel, tag row). It scrolls away with the document rather than
	 *  pinning, which is what lets the editor keep its own scrollport and windowing. */
	header?: Snippet;
	blockDragHandles?: boolean;
	searchBar?: boolean;
	/** Where the editor's own find/replace bar renders. Default (absent) keeps it pinned inside
	 *  the editor root; an element relocates the SAME bar into it, theme scope included, so
	 *  host-scroll embeds can put it in a pane's chrome instead of mid-page. Read live, and
	 *  ignored while `searchBar` is false. Positioning inside it is the element's own business. */
	searchBarAnchor?: HTMLElement | null;
	/** Who owns the scroll, set once at mount. `'self'` (default) makes the root its own
	 *  scrollport, so windowing keeps the mounted set O(viewport). `'host'` lets an
	 *  ancestor scroll it: windowing never activates and EVERY block stays mounted, which
	 *  suits a small embedded document, never a whole file. */
	scrollMode?: 'self' | 'host';
	/** Theme name reflected to `data-editor-theme` on the editor root. Built-ins:
	 *  `'dark'` (default) and `'light'`; any other value activates a consumer's
	 *  own `.editor[data-editor-theme='<name>']` token block. */
	theme?: string;
	/** How the document presents, read live like `theme`; `'source'` by default. The consumer
	 *  guide's Presentation modes section describes what each rung shows and allows. */
	presentationMode?: PresentationMode;
	/** Per-instance keymap overrides over the built-in command vocabulary. */
	keybindings?: KeybindingOverride[];
	/** Plugins installed once, in array order, at mount. Set-once: a later change to
	 *  this prop is ignored — installation is process-global and cannot re-run. An
	 *  entry may be a bare unit or `{ plugin, options }` for per-instance options. */
	plugins?: readonly EditorPluginEntry[];
}

/** The `bind:this` surface a consumer can name and hold a ref to. */
export interface EditorInstance {
	getSource(): string;
	getSelection(): EditorSelection | null;
	/**
	 * Restore a `getSelection()` snapshot. Async because the target is scrolled into view
	 * first, and true means it got there, not merely that it mounted. Never throws: an
	 * out-of-range offset clamps in that endpoint's own coordinate space (a TABLE
	 * endpoint's row-major cell index clamps to the last cell, not a character position),
	 * and an unresolvable path or an unsettled scroll resolves false.
	 */
	setSelection(selection: EditorSelection): Promise<boolean>;
	/**
	 * Land the caret at a viewport point exactly as a click there would: the point clamps into the
	 * nearest block's box, the block under it resolves the landing, a live cross-block range ends
	 * first. For a shell owning chrome beside the document: the shell decides whether a click on
	 * its own territory comes here, the editor decides where the caret goes. False when no
	 * focusable landing resolves. Points resolve against MOUNTED blocks, so one below the document
	 * lands in the last rendered block.
	 */
	placeCaretAtPoint(x: number, y: number): boolean;
	/**
	 * Insert markdown at the caret exactly as pasting it would, minus the clipboard: paste
	 * transforms, every container-aware strategy, delete-selection-first, one undo entry, and
	 * focus at the end of the insertion. True means the pipeline took the text, not that its
	 * commit has flushed — read the result back through the `edit` event. False, and nothing
	 * mutates, when this editor holds no caret, in reading mode, or at a gap caret.
	 */
	insertMarkdown(md: string): boolean;
	/**
	 * Run a command by id at the focused surface, no chord in the path, so a consumer's
	 * `keybindings` rebind cannot rewire a toolbar button. `TOOLBAR_COMMANDS` names the
	 * supported ids. Semantics match the same command pressed as a chord: same arm, one undo
	 * entry, same caret. False, and nothing mutates, on an unknown id, in reading mode, with no
	 * focused block for a block-local id, and on a single-block rewrite (the format toggles, the
	 * link editor) while a cross-block range is painted. A minted plugin command stays chord-only.
	 */
	runCommand(commandId: string): boolean;
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
	/**
	 * Every MODIFIER chord this instance consumes, normalized (`Mod` covers Ctrl and Cmd).
	 * Composed live from the kind keymaps, the command tables, installed plugins, the
	 * `keybindings` overrides and the search option, so a host accelerator table can be derived
	 * rather than hand-copied. Bare keys are out of contract: a focused document owns them. So is
	 * a DISABLED chord (`command: null`), released for the host to claim app-wide — yet still
	 * swallowed INSIDE the editor, whose native fall-through would bypass the CST undo stack.
	 */
	reservedChords(): ReadonlySet<string>;
	/** Whether this instance consumes that keystroke, answered with the editor's own chord
	 *  normalization so a host never re-implements the Ctrl/Cmd fold. */
	claimsChord(event: KeyboardEvent): boolean;
}

/**
 * The diagnostics door: arm the interaction trace, read it, and serialize an attachable
 * field report. The recorder ships default-off, so a consumer opts in, reproduces, then
 * serializes. The trace is process-global — two instances interleave their entries.
 */
export interface EditorDiagnostics {
	enableTrace(): void;
	disableTrace(): void;
	isTraceEnabled(): boolean;
	traceSnapshot(): InteractionTraceEntry[];
	/**
	 * A fenced-markdown snapshot (timestamp, trace tail, ops-log tail, selection). The
	 * document source is EXCLUDED by default; pass `{ includeSource: true }` to opt in.
	 */
	serializeDiagnostics(opts?: { includeSource?: boolean }): string;
}
