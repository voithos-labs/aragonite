# Editable-content tiers

Part of the [plugin guide](../plugin-guide.md). Its worked examples are the parrot from [the quickstart](../plugin-guide.md#the-first-fifteen-minutes) and the conspiracy box from [the container walkthrough](container-walkthrough.md).

Content that's _itself editable_ comes in four tiers, all of them pre-freeze:

| Tier              | What it hosts                                                                    |
| ----------------- | -------------------------------------------------------------------------------- |
| **Container**     | Real document blocks in a nested child list; the walkthrough's body              |
| **Chrome leaf**   | One reserved, single-line, plain-text child whose bytes the container's raw owns |
| **Editable leaf** | A standalone text surface with native caret/IME/undo/selection/clipboard parity  |
| **Atomic widget** | An opaque, non-text embed, which the caret can address only at its edges         |

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

An editable leaf is a block whose text the editor edits the way it edits a paragraph's, inside an element you made. Ask for one with `surface: 'leaf'` on `defineBlockView` and hand that element to `ctx.leaf.attach`:

```ts
const noteView = defineBlockView({
	surface: 'leaf',
	singleLine: true, // a one-line kind: Enter splits the block instead of typing a newline
	mount(target, ctx) {
		target.className = 'note'; // `target` is the element the editor made, and measures, as the block
		const badge = document.createElement('span');
		badge.textContent = 'note';
		const text = document.createElement('div');
		target.append(badge, text);
		ctx.leaf.attach(text);
		return {};
	}
});
```

In return your block behaves like any built-in text block: the caret walks in and out (keeping its column), IME composition works, undo batches like prose, copy and paste go through the editor, and a cross-block selection sweeps through your text. (React or Vue? `<LeafContent>` does the `attach` for you, see [React and Vue blocks](react-and-vue.md#a-memo-in-react).)

**The attached element is the editor's.** The editor fills it so that **`textContent === source`**, which is what the caret's mapping between screen positions and bytes relies on, so your own elements (the badge) go beside it, never inside. It also puts every handler and attribute the text needs on it, a textbox role and an `aria-label` naming your kind (its descriptor's `label`) included. Reading mode swaps those out, since a block there is text to read: a heading reads as a heading, anything else as its text. That covers the element's tab stop too, so don't give it a `tabindex` yourself: in reading mode the editor keeps one tab stop for the whole document and moves it to whichever block the reader was last in.

That text carries every newline your source holds, which makes **`white-space: pre-wrap` (or `pre`) on your source element part of the contract** for any leaf whose bytes can span lines. Without it the browser collapses the line breaks on screen while the byte count goes on counting them, and the caret sits nowhere near where it looks.

**The empty-block hint comes free too** (the consumer's `placeholder` prop), so there's nothing to write for it. A block counts as empty when its content range is. If your kind draws its own fence lines, that range never empties (the fences are bytes too), so declare `bodyRange`: the body a user types into, or null while there's no body line yet. `fencedBodyRange` does the work from a `sliceFencedSource` split:

```ts
registerBlockKind(kind, {
	// …the rest of your registration
	bodyRange: (node) => fencedBodyRange(sliceFencedSource(node.raw))
});
```

A block that edits through an element of its own instead of a leaf (the bundled mermaid's textarea) gets no hint.

The leaf comes in two modes, and the surface picks which:

- **`'leaf'`**: the source is always the editable view, and every keystroke commits to the tree (with prose-like undo batching), so your `update` runs once per key. Outside rewrites (an undo, say) show up in the source, and the surface goes inert in reading mode on its own.
- **`'render-primary'`**: a rendered view by default, where focus, a click, or an arrow reveals the raw source, and leaving it commits **once**, so the whole reveal, edit, blur cycle is one undo entry. `update` tells you which half to show through `state.revealed`. Attach the source element from inside the `update` that reveals (that's when the caret goes looking for it, and a dev build warns if it's late), and `attach(null)` when it folds. `ctx.leaf.attachRendered(el)` names the folded view: a click there reveals, at the spot your kind's `caretTargetAtPoint` names (declare none and every click reveals at the first byte). Hand it `target` itself and the whole block, chrome included, is one click target.

```ts
const labelView = defineBlockView({
	surface: 'render-primary',
	singleLine: true,
	mount(target, ctx) {
		ctx.leaf.attachRendered(target);
		const label = document.createElement('strong');
		const source = document.createElement('div');
		const draw = ({ revealed, node }: BlockViewState) => {
			label.textContent = node.raw.slice('@@ '.length).trim();
			// only on a flip: a fresh source element mid-edit would lose the typing in it
			if (target.firstChild === (revealed ? source : label)) return;
			target.replaceChildren(revealed ? source : label);
			ctx.leaf.attach(revealed ? source : null);
		};
		draw(ctx.state());
		return { update: draw };
	}
});
```

**A painted source.** By default the source is one text node. Give a render-primary view a `renderSource(text)` and it paints the source as DOM instead: fence lines the marker-hiding modes collapse, highlight tokens, whatever your kind draws. `renderFencedSource` draws a fenced source the way the code block does, with `highlightCode` as its tokenizer. The editor checks `textContent === text` on every paint, so a painter that drops a byte fails loudly in dev rather than corrupting a commit.

A painted source takes its plain-text edits from the leaf, not the browser: typing, Enter, deletes and pastes splice the text and repaint. Undo inside the open reveal walks those edits back before it reaches the document's history, whether you pressed the undo key or picked Undo from the browser's menu. An edit the browser makes itself (an IME commit) gets repainted too. Two more pieces go with a painter:

- **`afterInput(text)`**, on the handle `mount` returns, hears every change to the shown source once (yours, the browser's, an undo's), so a live preview can follow the text before it's committed. It stays quiet mid-composition.
- **`reshapeSource(text, caret, lineEnding)`**, next to `renderSource` in the view, lets your kind put an edited source back in the shape it keeps. It's asked as the source is revealed and again after every edit, the browser's included, with `caret` where the caret sits in `text` right then. Answer the new text and the caret's place in it, or null to leave both alone.

Block math uses `reshapeSource` twice:

```ts
reshapeSource('$$\n$$', 2, '\n'); // { text: '$$\n\n$$', caret: 3 }: an empty body line for the caret
reshapeSource('$$x\n^2$$', 4, '\n'); // { text: '$$\nx\n^2\n$$', caret: 5 }: Enter in a one-line block
```

The first means a one-line `$$x^2$$` that loses its `x^2` never shows bare fences, and the second turns a one-line block you press Enter in into the multi-line form right away. Keep it in step with your `rawWrite`, the rule every write of your bytes goes through (the commit on blur included), so what the user sees while typing is what lands. A line you add with no ending to copy (a one-line `$$$$` has none) takes the `lineEnding` you're handed, the block's own or else the document's, so a CRLF file stays CRLF.

A leaf whose bytes are one line (the parrot's opener claims exactly one) declares `singleLine: true` and needs none of that; Enter then ends the block, as the quickstart showed. With the flag off, the default, Enter types a newline in the block's own line ending.

**Commit semantics.** A commit parses the edited text and lands it the way the editor lands any edit, by what the parse gives back:

```
commit(edited text) ── parse ──▶ same kind?        update in place, caret preserved
                                 different kind?   remount the block
                                 several blocks?   structural replace: the leaf becomes
                                                   all of them, the caret following the
                                                   edit position into its block
```

So editing past your own fence re-splits the document instead of wedging foreign text into your node.

**Per-instance configuration.** `ctx.editor.options` is this editor's options for the plugin owning your kind, already merged over your `defaults`. It's typed `unknown`, so cast it to the type your `defaults` has. The bundled toc block's `maxDepth` is one of these, with `tocPlugin({ maxDepth })` filling the default.

### Already in Svelte?

`createEditableLeaf`, from `@voithos-labs/aragonite/svelte`, is the same leaf as a factory your component calls (the container factory's sibling). It reads the editor's contexts itself, so its deps are live thunks: `getNode`, `getIndex`, `getPath`, plus `getEl()` returning your source contenteditable.

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

What a DOM view gets by attaching, a component gets from spreads:

- **`<div {...leaf.surfaceProps}>`** on the source contenteditable puts the handlers and attributes on it. Add your own `class` / `aria-label`, plus **`bind:this`**, since the factory only reaches the element through `getEl()`.
- **`renderProps`** goes on the folded view of a render-primary block, where the quickstart's DOM parrot calls `attachRendered`. Put it on a wrapper the reveal never unmounts and the whole folded surface, chrome included, is one click target.
- `mode` picks plain or render-primary, and you own the swap flag (`isRevealed` / `setRevealed`) where a DOM view reads `state.revealed`.
- `renderSource`, `reshapeSource` and `onSourceEdit(text)` (the DOM view's `afterInput`) are deps.
- `leaf.getOptions<MyOptions>()` returns this editor's options typed as you name them, and just your `defaults` with no editor around (a component mounted bare in a unit test), once your plugin is installed.

Block math (`$$…$$` in the bundled `@voithos-labs/aragonite-latex` plugin) is the worked example, and it's smaller than you'd expect: the factory call with a painted source, one render effect (KaTeX), the spread, and the `blockApi` export. Registration is the ordinary leaf recipe plus an on-type completer for a lone `$$`. Its `caretTargetAtPoint` is worth a look too: KaTeX paints glyphs no offset maps back to, so the render effect stamps the formula's span on the rendered element and the hook walks that span in proportion to how far along the click fell.
