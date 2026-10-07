# Recipe: reading the document above your block

Part of the [plugin guide](../plugin-guide.md).

A block component gets its own node, which is fine right up until it isn't: a table-of-contents block needs the headings above it, and a cross-reference needs an id defined somewhere else entirely. `BlockComponentProps.document` delivers the read-only root document to every component, at any nesting depth:

```svelte
<script lang="ts">
	import { getContentRange, walkBlocks, type DocumentView } from '@voithos-labs/aragonite/plugin';

	// A component receives its own node too; this block needs only the document.
	let { document }: { document?: DocumentView } = $props();

	// A $derived over the prop re-runs when the document changes, so editing a
	// heading above updates the list live.
	const headings = $derived.by(() => {
		const found: { path: number[]; text: string }[] = [];
		if (!document) return found;
		walkBlocks(document, (block, path) => {
			if (block.kind !== 'heading' && block.kind !== 'setextHeading') return;
			const { start, end } = getContentRange(block); // drop the `#` / underline markers
			found.push({ path, text: block.raw.slice(start, end) });
		});
		return found;
	});
</script>

<nav>
	{#each headings as heading}<div>{heading.text}</div>{/each}
</nav>
```

`document` is a **`DocumentView`**, read-only by type ([Views](../plugin-guide.md#views-what-you-read-what-you-own)).

Reading `document.children` gets you the top-level blocks and nothing else, so a heading inside a quote or a list item would go missing. That's what `walkBlocks` is for.

**`walkBlocks(root, visit, basePath?)`**

Calls `visit(block, path)` for every block under `root` (a document, or any block you hold), parents before their children, in the order they sit in the document. `root` itself isn't visited. The path is the list of child indices from `root` down to the block, a fresh array per call, so keep it if you like. What `visit` returns steers the walk:

- nothing: carry on, children included
- `'skip'`: leave this block's children out
- `'stop'`: end the walk right here, and `walkBlocks` returns `true` (it returns `false` when it ran to the end)

Walking a block you found at some path? Pass that path as `basePath`, and every path you get back is a document path again.

```ts
const doc = parse('# Top\n\n> ## Quoted\n> text\n');
walkBlocks(doc, (block, path) => console.log(path, block.kind));
// [0] 'heading'
// [1] 'blockquote'
// [1, 0] 'heading'
// [1, 1] 'paragraph'
```

The other direction, a path you already have to its block, is `blockNodeAt`. It answers `null` for a path that leads nowhere, and for the empty path too (that's the document, which isn't a block). Here it is next to the recipe's other calls:

```ts
blockNodeAt(doc, [1, 0])?.raw; // '## Quoted\n'
blockNodeAt(doc, []); // null
getContentRange(parse('# Hi\n').children[0]); // { start: 2, end: 4 }: the two bytes of 'Hi', markers skipped
getContentRange(parse('plain text\n').children[0]); // { start: 0, end: 10 }: a paragraph has no markers to skip
await rects.navigateTo([1, 0]); // true once the quoted heading is in view with the caret at its start
```

A block that needs to _navigate_ to what it read (a table-of-contents entry jumping to its heading) gets the editor's geometry as **`BlockComponentProps.rects`**, the same object `EditorContext.rects` hands your per-instance callback. `rects.navigateTo(path, offset?)` scrolls to the target and lands the caret there; an affordance that only scrolled would leave focus on its own button, where the editor's chords don't reach. Use `scrollTo(path)` where the viewport should move but the selection shouldn't. Both work in reading mode too. The bundled **toc** plugin is this recipe end to end.
