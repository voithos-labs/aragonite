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
import type { EditorPlugin } from './schema/plugin-install';

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
	 *  this prop is ignored — installation is process-global and cannot re-run. */
	plugins?: readonly EditorPlugin[];
}

/** The `bind:this` surface a consumer can name and hold a ref to. */
export interface EditorInstance {
	getSource(): string;
	getSelection(): EditorSelection | null;
	getEvents(): EditorEvents;
	getSearch(): SearchState;
}
