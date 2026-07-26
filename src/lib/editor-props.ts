/**
 * Public prop and instance-handle types for <Editor>. Single source of truth:
 * Editor.svelte annotates its $props() and instance surface against these, and
 * index.ts re-exports them — so neither can drift from the component.
 */
import type { ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
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
	blockDragHandles?: boolean;
	searchBar?: boolean;
	/** Theme name reflected to `data-editor-theme` on the editor root. Built-ins:
	 *  `'dark'` (default) and `'light'`; any other value activates a consumer's
	 *  own `.editor[data-editor-theme='<name>']` token block. */
	theme?: string;
	/** Read live, like `theme`. `'source'` (default) is styled-source editing;
	 *  `'reading'` hides markers, renders widgets, and is read-only
	 *  (selection/copy/navigation stay); `'preview-block'` and `'preview-inline'`
	 *  are live-editing preview rungs that reveal source per focused block or per
	 *  caret-touched construct. Every mode read (the `data-presentation` root
	 *  attribute, plugin getters) reports the effective mode, which equals the
	 *  requested one. */
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
	 * Restore a `getSelection()` snapshot. Async because the target is scrolled into
	 * view first, and a true result means it got there — not merely that it mounted.
	 *
	 * An out-of-range offset clamps to the end of its block, in that endpoint's own
	 * coordinate space: character offsets clamp to the block's source length, but an
	 * endpoint addressing a TABLE block carries a row-major cell index and clamps to
	 * the last cell (see {@link SelectionPoint}) — a large offset there becomes the
	 * bottom-right cell, not a character position.
	 *
	 * Never throws. Resolves false in two cases, which differ in their effect: a
	 * path that no longer addresses a block is declined before anything happens
	 * (no scroll, no focus, no state write), while a path that resolves in the
	 * tree but whose element is absent from the DOM has already scrolled and
	 * re-established cross-block state by the time placement fails.
	 */
	setSelection(selection: EditorSelection): Promise<boolean>;
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
}

/**
 * The diagnostics door: arm the interaction trace, read it, and serialize an
 * attachable field report for a bug ticket. The recorder ships default-off, so a
 * consumer opts in (`enableTrace()`), reproduces, then serializes. The trace is
 * process-global: two editor instances interleave their entries.
 *
 * Grows as fields: future diagnostics arrive as more methods on this one object,
 * never a second door — the additive rule the whole extension surface follows.
 */
export interface EditorDiagnostics {
	enableTrace(): void;
	disableTrace(): void;
	isTraceEnabled(): boolean;
	traceSnapshot(): InteractionTraceEntry[];
	/**
	 * A fenced-markdown snapshot (timestamp, trace tail, ops-log tail, selection).
	 * The document source is EXCLUDED by default — a field report must not leak the
	 * document; pass `{ includeSource: true }` to opt in.
	 */
	serializeDiagnostics(opts?: { includeSource?: boolean }): string;
}
