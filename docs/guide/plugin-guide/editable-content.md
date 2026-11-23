# Editable-content tiers

Part of the [plugin guide](../plugin-guide.md). Its worked examples are the parrot from [the quickstart](../plugin-guide.md#the-first-fifteen-minutes) and the conspiracy box from [the container walkthrough](container-walkthrough.md).

Content that's _itself editable_ comes in four tiers, all of them pre-freeze:

| Tier | What it hosts |
| --- | --- |
| **Container** | Real document blocks in a nested child list; the walkthrough's body |
| **Chrome leaf** | One reserved, single-line, plain-text child whose bytes the container's raw owns |
| **Editable leaf** | A standalone text surface with native caret/IME/undo/selection/clipboard parity |
| **Atomic widget** | An opaque, non-text embed, which the caret can address only at its edges |

The chrome leaf is deliberately narrow, and each limit is a guarantee its container can lean on:

- **Always present**: a destructive range clears it rather than deleting it.
- **Single-line and unsplittable**: paste into it flattens to inline.
- **Kind-stable**: it stays the same kind through every edit.

The contract guarantees the empty leaf's presence, not its look. An empty-state affordance (placeholder text over an untitled title, say) is yours to build with CSS on the leaf's block class.

**Declare `gapEdges` for every kind: it names the edges where your surface traps the caret.** A grid, a fence or an opaque embed leaves the boundary it shares with a neighbour unreachable: no caret can sit there, so no paragraph can be typed between two of them. The field's values:

- `'before'` / `'after'` / `'both'` opens the named edges to a between-blocks caret, where typing or Enter inserts a paragraph.
- `'none'` says your surface already hosts insertion at both edges.

The bundled kinds set the precedent: an opaque container whose fences leave no textual way out (the callouts, details, the generic directive container) declares `'both'`; a container whose own edges are prose the caret can already stand on (a blockquote's marked lines, a list item's) declares `'none'`.

A fifth tier, a second editor nested inside your block whose state saves as an opaque blob, is never getting built (and yes, people ask): it can't save back the bytes it read.

## The editable leaf

An editable leaf is a block whose text the editor edits the way it edits a paragraph's. Every block type with text gets one: `ctx.source` in your `draw` is the editor's own element for that text, and all you do is put it somewhere in your drawing. `edit: 'text'` keeps it on screen all the time:

```ts
const note = lineBlock({
	name: 'note',
	label: 'Note',
	match: /^!note (?<text>.*)$/,
	sample: '!note remember the milk',
	insert: { none: 'typed, never inserted' },
	edit: 'text',
	draw(block, ctx) {
		const dom = document.createElement('div');
		dom.className = 'note';
		const badge = document.createElement('span');
		badge.textContent = 'note';
		dom.append(badge, ctx.source); // the badge sits beside the text, where nobody types into it
		return { dom };
	}
});
```

In return your block behaves like any built-in text block: the caret walks in and out (keeping its column), IME composition works, undo batches like prose, copy and paste go through the editor, and a cross-block selection sweeps through your text. (React or Vue? See [React and Vue blocks](react-and-vue.md#a-memo-in-react).)

**`ctx.source` is the editor's.** The editor fills it so that **`textContent === source`**, which is what the caret's mapping between screen positions and bytes relies on, so your own elements (the badge) go beside it, never inside (a dev build warns when your drawing puts one there). It also puts every handler and attribute the text needs on it, a textbox role and an `aria-label` naming your block type (its `label`) included, and `white-space: pre-wrap`, so a text that spans lines shows its line breaks. Reading mode swaps those out, since a block there is text to read. That covers the element's tab stop too, so don't give it a `tabindex` yourself: in reading mode the editor keeps one tab stop for the whole document and moves it to whichever block the reader was last in.

**The empty-block hint comes free too** (the consumer's `placeholder` prop), so there's nothing to write for it. A box (`edit: 'box'`) edits through an element of its own (the bundled mermaid's textarea, say), so it gets none.

The leaf comes in two modes, and `edit` picks which:

- **`'text'`**: the text is always the editable view, and every keystroke commits to the tree (with prose-like undo batching), so your `update` runs once per key. Outside rewrites (an undo, say) show up in it, and it goes inert in reading mode on its own.
- **`'source'`**, the default once you give a `draw`: a picture by default, where focus, a click or an arrow shows the text, and leaving it commits **once**, so the whole show, edit, leave cycle is one undo entry. `ctx.focused` tells you which to show, and `update` runs when it flips. Keep `ctx.source` placed the whole time; the editor hides it while the picture shows. The whole folded drawing is one click target, and `Drawn.caret` says where a click lands: an element whose text is the block's text (a caption, say, landing on the letter clicked), or a function from the clicked point to an offset in the text. Hand back neither and every click opens the text at the start of its line.

```ts
const label = lineBlock({
	name: 'label',
	label: 'Label',
	match: /^@@ (?<text>.*)$/,
	sample: '@@ hello',
	insert: { none: 'typed, never inserted' },
	draw(block, ctx) {
		const dom = document.createElement('div');
		const shown = document.createElement('strong');
		const show = (next: Block<never>, now: TextDrawContext) => {
			shown.textContent = now.typed ?? next.body;
			shown.hidden = now.focused;
		};
		show(block, ctx);
		dom.append(shown, ctx.source);
		return { dom, caret: shown, update: show };
	}
});
```

**A painted source.** A `lineBlock`'s marker and a `fencedBlock`'s fence lines are the editor's: it draws them dimmed, as the built-in blocks draw theirs, and hides them in the modes that hide markers. By default the text inside them (a line block's `text` group, a fenced block's body) is one text node. Give the spec a `renderSource(text, paint)` and it paints that text as DOM instead, any node you return: highlight tokens, whatever your block draws. With no `draw`, the editor shows the painted text alone, in place of its own text block. `paint.code(body, language)` highlights with whatever highlighter the editor lists, and paints plain without one. The editor checks `textContent === text` on every paint, so a painter that drops a byte fails loudly in dev rather than corrupting a commit.

The fence lines come with two shapes the shown text keeps while it's edited. A closed block with no body line gets an empty one, for the caret to sit on once the fence lines hide. A line break typed into a one-line block's text (a fence with `oneLine`) puts its fences on lines of their own at once:

```
$$\n$$     is shown as $$\n\n$$, the caret on the empty line
$$x^|2$$   with Enter at the caret, is shown as $$\nx^\n2\n$$
```

A painted source takes its plain-text edits from the leaf, not the browser: typing, Enter, deletes and pastes splice the text and repaint. With a `renderSource`, undo inside the open text walks those edits back before it reaches the document's history, whether you pressed the undo key or picked Undo from the browser's menu. An edit the browser makes itself (an IME commit) gets repainted too. Two more pieces go with a painter:

- **`ctx.typed`** is the text as typed and not yet written, inside the marker or fence lines as `block.body` reads it (null while the picture shows), and `update` runs after every change to it (yours, the browser's, an undo's), so a live preview can follow the text before it's committed. It stays quiet mid-composition.
- **`reshapeSource(text, caret, lineEnding)`**, next to `renderSource` on the spec, lets your block put an edited text back in a shape of its own. It's handed the whole shown text as it's shown and again after every edit, the browser's included, with `caret` where the caret sits in `text` right then, and runs before the fence's own shapes above. Answer the new text and the caret's place in it, or null to leave both alone. Keep it in step with the rule every write of your bytes goes through (the commit on leaving included), so what the user sees while typing is what lands. A line you add with no ending to copy takes the `lineEnding` you're handed, the block's own or else the document's, so a CRLF file stays CRLF.

A `lineBlock` is one line, so Enter ends the block, as the quickstart showed. A `fencedBlock`'s text spans lines, so there Enter types a newline in the block's own line ending.

A gap caret, the caret that stands between two blocks, sits wherever the caret can't reach your block's edge: on both sides of a `fencedBlock` and of a block drawn with `edit: 'source'`, and above an `edit: 'box'` block, whose Enter opens a paragraph below. A `lineBlock` whose text shows gets none, since Enter splits it at either end.

**Commit semantics.** A commit parses the edited text and lands it the way the editor lands any edit, by what the parse gives back:

```
commit(edited text) ── parse ──▶ same kind?        update in place, caret preserved
                                 different kind?   remount the block
                                 several blocks?   structural replace: the leaf becomes
                                                   all of them, the caret following the
                                                   edit position into its block
```

So editing past your own fence re-splits the document instead of wedging foreign text into your node.

**Per-instance configuration.** Your plugin's `contributes(options)` runs once per editor with that editor's options, already merged over your `defaults`, so a `draw` made in there closes over them. The bundled toc block's `maxDepth` is one of these: an editor listing `toc({ maxDepth: 3 })` lists three levels.

### Already in Svelte?

A kind you register with `registerBlockKind` and draw with your own Svelte component (through `svelteBlockView`) gets the same leaf from `createEditableLeaf`, from `@voithos-labs/aragonite/svelte`, a factory your component calls (the container factory's sibling). It reads the editor's contexts itself, so its deps are live thunks: `getNode`, `getIndex`, `getPath`, plus `getEl()` returning your source contenteditable.

```ts
const leaf = createEditableLeaf({
	getNode: () => node,
	getIndex: () => index,
	getPath: () => myPath,
	getEl: () => sourceEl ?? null, // null while a render-primary view is folded
	mode: 'render-primary', // 'plain' is the default
	singleLine: true, // a one-line kind: Enter splits the block instead of typing a newline
	isRevealed: () => revealed, // render-primary only; leaving it out there won't compile, or throws
	setRevealed: (next) => (revealed = next)
	// optional too: commandHooks, handed to your block commands as ctx.hooks (see Block commands)
});
leaf.blockApi; // everything the editor calls on your block: your component's one export
leaf.sourceText; // the block's raw minus its trailing line ending
leaf.getPresentationMode(); // 'source'
leaf.getOptions<MyOptions>(); // this editor's options for your plugin, defaults included
leaf.getEditor(); // this editor's EditorContext for your plugin, undefined in a bare harness
```

What `ctx.source` comes with in a `draw`, a component wires up itself:

- **`<div {...leaf.surfaceProps}>`** on the source contenteditable puts the handlers and attributes on it. Add your own `class` / `aria-label`, plus **`bind:this`**, since the factory only reaches the element through `getEl()`.
- **`white-space: pre-wrap` (or `pre`) on that element** is on you here, for any leaf whose bytes can span lines. Without it the browser collapses the line breaks on screen while the byte count goes on counting them, and the caret sits nowhere near where it looks.
- **`renderProps`** goes on the folded view of a render-primary block. Put it on a wrapper the reveal never unmounts and the whole folded surface, chrome included, is one click target.
- `mode` picks plain or render-primary (`edit: 'text'` and `'source'` above), and you own the swap flag (`isRevealed` / `setRevealed`) a `draw` reads as `ctx.focused`.
- `renderSource`, `reshapeSource` and `onSourceEdit(text)` (the shown text, whose body a `draw` sees as `ctx.typed`) are deps.
- `leaf.getOptions<MyOptions>()` returns this editor's options typed as you name them, and just your `defaults` with no editor around (a component mounted bare in a unit test), once your plugin is installed.
- A kind that draws its own fence lines never has an empty content range (the fences are bytes too), so the empty-block hint needs `bodyRange` on its registration: the body a user types into, or null while there's no body line yet. A `fencedBlock` declares its own.

Block math (`$$…$$` in the bundled `@voithos-labs/aragonite-latex` plugin) is a `fencedBlock` with a `draw` now, so it shows what the editor does for you rather than this factory.
