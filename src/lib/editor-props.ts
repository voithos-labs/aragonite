/**
 * Public prop and instance-handle types for <Editor>. Single source of truth:
 * Editor.svelte annotates its $props() and instance surface against these, and
 * index.ts re-exports them — so neither can drift from the component.
 */
import type { ResolveImageUrl, ResolveLinkUrl } from './editor-keys';
import type { ImageLoadPolicy } from './core/inline-render';
import type { KeybindingOverride } from './schema/keybinding-overrides';
import type { EditorSelection } from './selection/primitives';
import type { EditorEvents } from './editor-events';
import type { SearchState } from './reactivity/search-state.svelte';
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
	getEvents(): EditorEvents;
	getSearch(): SearchState;
	getDecorations(): DecorationRegistry;
	getRects(): EditorRects;
	getDiagnostics(): EditorDiagnostics;
}

/**
 * The diagnostics door: arm the interaction trace, read it, and serialize an
 * attachable field report for a bug ticket. The recorder ships default-off, so a
 * consumer opts in (`enableTrace()`), reproduces, then serializes.
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
