// The Svelte API, published at the `@voithos-labs/aragonite/svelte` subpath: the `<Editor>`
// component and everything whose types name Svelte's, for a host or plugin written in Svelte. The
// rest of the package names no Svelte type, so a React or Vue app type-checks without Svelte.

// ── The editor component ─────────────────────────────────────────────────────

export { default as Editor } from './components/Editor.svelte';
export type { EditorProps } from './components/editor-component-props';

// ── Plugin views from Svelte components ──────────────────────────────────────

export { svelteBlockView } from './components/svelte-block-view';
// A block type's `draw` from a Svelte component, placing the editor's elements with `<Slot>` and
// adding a `focus`, `keep`, `caret`, `save` or `controls` with `useDrawn`.
export {
	svelteBlock,
	useDrawn,
	type SvelteBlockOptions,
	type SvelteBlockProps
} from './components/drawn-block/svelte-block.svelte';
export { svelteView } from './svelte-view.svelte';

// ── Editable-leaf authoring (pre-freeze) ─────────────────────────────────────
// A text-editing leaf with a built-in block's caret, IME, undo and selection: plain (a commit per
// keystroke) or render-first (source while the caret is inside, one commit on blur).

export { createEditableLeaf } from './components/blocks/editable/editable-leaf';
export type {
	EditableLeaf,
	EditableLeafDeps,
	EditableLeafMode,
	EditableLeafSurfaceProps,
	EditableLeafRenderProps
} from './components/blocks/editable/editable-leaf';

// ── Container authoring (pre-freeze) ─────────────────────────────────────────
// An editable nested container as thin as the built-in blockquote, touching no editor context key.

export { default as BlockList } from './components/BlockList.svelte';
export { createContainerBlock } from './editor-actions/plugin/container';
export type {
	ContainerBlock,
	ContainerBlockComponent,
	ContainerBlockDeps,
	ContainerBlockListProps
} from './editor-actions/plugin/container';
