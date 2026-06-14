# Editor

A CST block editor for GFM Markdown. The raw Markdown is the source of truth — the editor parses it into a lossless syntax tree, renders styled blocks with dimmed markers, and round-trips byte-for-byte. Ships as a library; the limestone app is its first consumer.

## Use it

```svelte
<script>
	import { Editor } from '$lib/editor';
	import '$lib/editor/styles/editor-theme.css';

	let editor;
</script>

<Editor bind:this={editor} {source} />
```

- `source` is read once at mount; `editor.getSource()` pulls the current Markdown back out.
- `editor.css` ships with the component automatically. Import `editor-theme.css` for the default palette, or supply your own tokens.

## Where next

| Document                                                                  | Scope                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| [`docs/editor/consumer-guide.md`](../../../docs/editor/consumer-guide.md) | Public API, theming, resolve/policy props, events |
| [`docs/design/editor/editor.md`](../../../docs/design/editor/editor.md)   | Editor design spec                                |
| [`docs/editor/adding-a-block.md`](../../../docs/editor/adding-a-block.md) | Adding a new block type (contributor-facing)      |
