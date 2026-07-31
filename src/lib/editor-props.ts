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
	/** Who owns the scroll, set once at mount. `'self'` (default) makes the root its own
	 *  scrollport, so windowing keeps the mounted set O(viewport). `'host'` lets an
	 *  ancestor scroll it: windowing never activates and EVERY block stays mounted, which
	 *  suits a small embedded document, never a whole file. */
	scrollMode?: 'self' | 'host';
	/** Theme name reflected to `data-editor-theme` on the editor root. Built-ins:
	 *  `'dark'` (default) and `'light'`; any other value activates a consumer's
	 *  own `.editor[data-editor-theme='<name>']` token block. */
	theme?: string;
	/** Read live, like `theme`. `'source'` (default) is styled-source editing; `'reading'`
	 *  hides markers, renders widgets, and is read-only (selection/copy/navigation stay);
	 *  `'preview-block'` and `'preview-inline'` are live-editing rungs that reveal source
	 *  per focused block or per caret-touched construct. */
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
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
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
