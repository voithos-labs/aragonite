# Recipes

Part of the [consumer guide](../consumer-guide.md). Worked examples built from the public calls (mostly [screen geometry](../consumer-guide.md#screen-geometry) and [the selection events](../consumer-guide.md#events)), plus one for rewriting a whole document at once.

## Recipe: navigating to a block

`getRects().navigateTo(path)` is the navigation call: jump to a heading, an outline entry, a cross-reference target. `scrollTo(path, opts)` is the same reveal-and-scroll without landing the caret, for moving the viewport without moving the selection (the built-in search does exactly that). Four things to know:

- **It mounts first.** A block virtual rendering has unmounted has no element to scroll to, so the call mounts it and then scrolls. `reveal(path)` is that same mount without the scroll, for measuring something offscreen.
- **The boolean is honest.** It resolves only after the position settles, so `true` means the block is genuinely in view, not merely that the call ran. A closed `<details>` on the way is opened first, as one undoable edit. In reading mode a section that shows closed can't be opened, so the target can't mount, and the call resolves `false` and leaves nothing pinned.
- **Both shapes hold the block where they put it.** The default `'nearest'` scrolls only as far as it has to (not at all for a block already on screen), and `'center'` puts it mid-viewport. Either way the block then stays right where it landed while stuff above it changes height (an image finishing loading, say). The hold lasts until the user presses a key, clicks or turns the wheel in the editor's scroll container, or the next `scrollTo`, `navigateTo` or caret scroll takes over; a `scrollTop` you write yourself doesn't end it, and the block gets put back the next time a height changes. So pass `hold: false` to hand the viewport straight back, which is what a restore that writes its own remembered scroll position afterwards wants.
- **Land the caret if a user asked to go there.** A navigation affordance that only scrolls leaves focus on whatever the user clicked, where the editor's chords don't reach: an undo typed right after the jump does nothing. `navigateTo` places the caret at the target (into the first line, for a block that holds others). Like `reveal` and `scrollTo`, it opens a closed `<details>` on the way. In reading mode there's no caret to place, so focus goes to the block, or to a widget with a tab stop that ends right at your offset (a footnote reference, say), and Tab carries on from there on every browser. That block becomes the editor's tab stop, too. `getSelection()` reads `null` afterwards.

Finding the path in the first place: `parse(getSource())` gives you the document tree (every node has a `kind` and containers have `children`), so collect the headings, recursing into containers so a heading inside a blockquote or list is reachable too:

```ts
import { parse } from '@voithos-labs/aragonite';

function headingPaths(node, path = []) {
	if (node.kind === 'heading' || node.kind === 'setextHeading') return [path];
	return (node.children ?? []).flatMap((child, i) => headingPaths(child, [...path, i]));
}

const paths = headingPaths(parse(editor.getSource())); // [[0], [4], [7, 2], ...]
await editor.getRects().navigateTo(paths[2]); // true
```

The bundled toc plugin does exactly that walk over its live document, and clicking one of its entries is a `navigateTo` call.

## Recipe: a selection toolbar

The editor ships one: a popover that opens beside a prose selection with the marks, the link, a heading picker (inside one block only), inline code and copy, on by default and off with `selectionToolbar={false}`. It's built on the public calls below and nothing else, so this recipe is also how to replace it with your own. Nine steps, and the anchoring ones have a snippet after the list:

1. **Subscribe to `selectionChange`.** A `null` payload or a collapsed selection (anchor equals focus) hides the bar.
2. **Put the endpoints in document order first.** `normalizeSelection(snapshot)` answers `{ start, end }` (by path, then by offset when the paths match), so a backward drag anchors exactly like a forward one. Anchor to `start`; a hand-rolled comparison gets the container-and-its-child pair wrong, where the shorter path is the earlier one.
3. **Cross-block selections** (start and end in different blocks): anchor to `rangeRects(start.path, start.offset, SELECTION_END)`, the start block's rects from the selection to its end. Rect `[0]` is the first visual line; place the bar above its top-left.
4. **Single-block selections**: `getSelection()` reports the range's real endpoints, so anchor with `rangeRects(start.path, start.offset, end.offset)`, the same call with a real end offset in place of `SELECTION_END`. A selection **inside a table** shares the table's path on both endpoints and carries cell indices in `offset`, with `cellCoordinate: true` on both, so exclude it by that flag, as the snippet below does.
5. **Re-anchor on the next `selectionChange`, not on scroll.** Rects are viewport-space snapshots; a `position: fixed` bar drifts under scroll until the selection next changes. Wire a scroll listener only if your UX demands live tracking.
6. **Fire the buttons through `runCommand`, not synthetic keystrokes**, so a user's rebind doesn't rewire your button ([Toolbar commands](../consumer-guide.md#toolbar-commands)).
7. **Grey the declining buttons out with `canRunCommand`, on the same `selectionChange`.** Ask it per button and disable the ones that answer `false`, so a selection spanning blocks shows the link button dimmed rather than dead while the format toggles stay live. Still read `runCommand`'s boolean.
8. **Paint the pressed states with `isCommandActive`, on that same `selectionChange`.** A selection already inside a bold run shows the bold button pressed (`aria-pressed` is the accessible spelling), and pressing it then unwraps. In live mode, a selection inside a link shows the link button pressed, and clicking it opens that link's card.
9. **Keep focus in the document**, for the same reason the insert toolbar does: cancel the button's mousedown default, or restore a `getSelection()` snapshot before calling.

```ts
import { normalizeSelection, SELECTION_END } from '@voithos-labs/aragonite';

editor.getEvents().on('selectionChange', (sel) => {
	if (!sel) return hide();
	const { start, end } = normalizeSelection(sel);
	if (start.cellCoordinate) return hide();
	const sameBlock = start.path.join('.') === end.path.join('.');
	if (sameBlock && start.offset === end.offset) return hide();
	const rects = editor.getRects().rangeRects(start.path, start.offset, sameBlock ? end.offset : SELECTION_END);
	if (rects[0]) showAbove(rects[0]); // DOMRect of the first visual line
});
```

The editor's own bar is this recipe, built out (`src/lib/components/menu/SelectionToolbar.svelte` in the aragonite repo), if you want a full reference to read.

## Recipe: an insert toolbar

`insertMarkdown(md)` and `getRects()` are a toolbar: one writes, the other positions. Since bytes are the API, every construct is a snippet, including one a plugin contributes, with no new call to learn.

```svelte
<button
	onmousedown={(e) => e.preventDefault()}
	onclick={() => editor.insertMarkdown('| Column | Column |\n| --- | --- |\n|  |  |\n')}
>
	Table
</button>
```

1. **Don't let the button take focus.** The call inserts at the caret, and a button that focuses on press has already destroyed it, so the call resolves `false`. Cancel the press default, as above, so focus never leaves the document, or stash a `getSelection()` snapshot and `setSelection` it back before inserting.
2. **Hand it canonical bytes.** A table button inserts `'| Column | Column |\n| --- | --- |\n|  |  |\n'`; a fence button `'```lang\n\n```\n'`. (A table is also typeable: a lone header row completed with `Enter` creates the same thing, per [Keyboard shortcuts](../consumer-guide.md#keyboard-shortcuts).)
3. **Position with `getRects()`.** `caretRect()` anchors a bar to the insertion point, `blockRect(path)` to the block. Both are viewport-space snapshots; re-read on the next `selectionChange`.
4. **Await the call before reading the result**, or read it on the `edit` channel: the commit lands on the editor's own flush, not on the line after the call.

The showcase's insert strip is this recipe, built out (`src/routes/InsertToolbar.svelte` in the aragonite repo), down to greying its buttons off `selectionChange` while there's no caret to insert at.

## Recipe: a typed-trigger menu

Tag autocomplete on `#`, a document picker on `[[`, a mention on `@`: a list that follows the caret while the author keeps typing, an inline menu. This is the one piece of chrome not to build yourself from `getRects()` and a key listener, because the editor has to be the one to notice the trigger, hold the keys, and write the pick. You hand it a trigger and a list; `getInlineMenus()` does the rest.

```ts
const handle = editor.getInlineMenus().addSource({
	name: 'doc-links',
	trigger: '[[',
	// End the session once the author closes the link by hand.
	accepts: (query) => !/[\]\n]/.test(query),
	items: async ({ query, signal }) => {
		const hits = await searchTitles(query, { signal });
		return hits.map((doc) => ({
			id: doc.id,
			label: doc.title,
			detail: doc.folder,
			insert: `[[${doc.linkText}]]`
		}));
	}
});
// A shortcut or a toolbar button: types `[[` at the caret and opens the same list.
editor.getInlineMenus().open('doc-links');
```

1. **`items` is the whole data contract.** Return an array, or a promise of one for a list read off an index. A slow answer a later keystroke superseded is dropped, and its `signal` aborts so you can cancel the read. A rejection is reported on the `error` event and reads as an empty list.
2. **`insert` is bytes.** The pick replaces the trigger and the query, the caret lands after it, and the whole replacement is one undo entry. There is no construct-specific call: a tag inserts `#work`, a link `[[Roadmap]]`. Add a trailing space there if your construct wants one. One line only: a line break is refused and reported on the `error` event, because those bytes belong to one block.
3. **A pick that inserts a block goes through `onCommit`.** That's the shape for a `/` command: give the row an empty `insert`, which just removes the trigger and the query, and have `onCommit` call `insertMarkdown` on the editor context it gets as its third argument, which puts the block in the way a paste would. The bundled slash-commands plugin works exactly like this. Two things about that context:
   - Make `onCommit` async and await the insert. Every write that lands while its promise is pending, up to the author's next input in this editor, joins the pick's undo entry, so one undo takes back the block and the cleared query together.
   - It's scoped to the pick. If your commit waits on something (a fetch for a title, say) and the host loads another note meanwhile, its writes land nowhere instead of in the new one.
4. **An empty list holds no key.** While rows are showing, the editor takes ArrowUp, ArrowDown, Enter, Tab and Escape before the focused block sees them. With nothing to show, the list is gone and Enter is the author's own Enter again, while the session stays alive for the next keystroke.
5. **`opensAt` and `accepts` are your grammar.** A tag declines a mid-word `#` (so `C#` stays text) and ends on a space; a link accepts spaces and ends on `]`. `open(name)` skips `opensAt`: the gesture is the author's say-so. `open(name, { query })` types a query after the trigger too, so the list opens narrowed.
6. **Some places never open a list, whatever your grammar says.** A trigger you type only opens where the bytes are prose: inside an inline code span, a link's destination or title, an image, an autolink or raw HTML it opens nothing, so a `#` in a URL fragment stays a fragment, and a destination still being typed (its closing `)` hasn't arrived yet) counts as a destination too. A link's own text is prose, and a trigger there opens. And no list opens at all in a table cell, in reading mode, or over a selection.
7. **Escape dismisses for good.** What was typed stays, and typing on does not reopen the list; only a new trigger does.
8. **Style it as you would the editor's other menus.** The list is the shared `.md-menu` surface and reads the same tokens. For rows richer than a label and a detail (a snippet, a highlighted match), pass a `row` view: a function that fills the element the editor hands it, given the `item`, whether it's `active`, and the `query`. It hands back an `update`, called as the row turns active or the query changes, and a `destroy`, where you unmount whatever you rendered there. In Svelte, `row: svelteView(TagRow)` (from `@voithos-labs/aragonite/svelte`) makes one from a component. A row whose view throws falls back to the default label, and the throw shows up on the `error` event. Your row keeps your page's styles, since the editor's reset stops at it.
9. **From a plugin, the same registry is `editor.inlineMenus`** on your `onEditor` context; return the handle's `dispose` from the callback. Add your source in `onEditor` itself, not after an `await` there: a pick's context is built on the context of the plugin that added the source, and a source added late gets the editor's own context instead, which belongs to no plugin, so its `options` reads as `{}`. A source you add through `editor.getInlineMenus()` gets that same context.

In the aragonite repo, the tag source in `examples/showcase/tag-marks.ts` is this recipe over a synchronous list, `src/routes/test/plugins/inline-menu/doc-link-menu-plugin.ts` over a late one, and `src/lib/plugins/slash-commands/slash-source.ts` over picks that insert blocks.

## Rewriting a document

For inserting at the caret rather than rewriting, the call is [`insertMarkdown`](../consumer-guide.md#inserting-markdown-at-the-caret). For rewriting a whole document (converting legacy syntax, migrating content, applying a bulk fix), work at the document level: read `getSource()`, transform the Markdown, write the result back through the `source` prop.

```svelte
<script>
	let source = $state(initial);
	let editor;

	function normalizeBullets() {
		source = editor.getSource().replaceAll(/^\* /gm, '- ');
	}
</script>

<Editor bind:this={editor} {source} />
```

The replacement is one document swap, so undo history and the caret don't survive it, and it's announced on `sourceSwap` rather than `edit`. A rewrite that changed nothing (no `*` bullets to begin with) hands the editor its own text, which isn't a swap at all, so undo survives that one.

A transformer working over `parse`'s output can lean on how the document is put back together: `serialize` is exactly `prefix + Σ(child.leadingTrivia + child.raw) + suffix` over the document's top-level children, so a rewrite can replace a top-level block's `raw` and reassemble without touching the rest. Only the top level counts: a container's `raw` already holds its children's bytes, so editing a nested block's `raw` changes nothing `serialize` reads.

````ts
import { parse, serialize } from '@voithos-labs/aragonite';

const doc = parse(editor.getSource());
for (const block of doc.children) {
	if (block.kind === 'fencedCode') block.raw = block.raw.replace(/^```js\b/, '```javascript');
}
source = serialize(doc); // every other block's bytes are exactly as they were
````
