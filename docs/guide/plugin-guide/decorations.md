# Decorations

Part of the [plugin guide](../plugin-guide.md).

Everything so far teaches the editor content you **own**: a kind, its grammar, its component. A decoration is the other half of the story, for annotating content you **don't own**. Highlight every occurrence of a word, ghost-complete a sentence, fold a range, badge a heading. Decorations are view-only: they never enter the document tree, never change `getSource()`, and never touch undo.

A plugin value paints with `paint(block)`, up next. A `setup` plugin registers a whole-document source from `onEditor` instead, which the rest of the page covers from [A whole-document source](#a-whole-document-source) on.

## Paint from a plugin value

`paint(block)` sits in your contribution beside `commands` and the rest. The editor calls it for each block of text it has on screen (a paragraph, a heading, a table cell, the paragraph inside a list item) and keeps the answer while that block's bytes stay the same, so typing in a paragraph asks that paragraph again and nothing else. A block off screen isn't asked until it scrolls in. A paint that reads other blocks (footnote numbers) says so with `paintDepends` and gets what it read as `paint`'s second argument: [the document recipe](reading-the-document.md).

```ts
import { definePlugin, type MarkAt, type Paint } from '@voithos-labs/aragonite/plugin';

// One function for every mark, so a mark painted again comes out the same.
const hover = (at: MarkAt | null) => (at ? popup.show(at.range, at.anchor) : popup.pointerLeft());

export const shouty = definePlugin({
	name: 'shouty',
	version: '1.0.0',
	editor: '^0.11.6',
	contributes: () => ({
		paint(block) {
			const marks: Paint[] = [];
			for (const m of block.text.matchAll(/\b[A-Z]{4,}\b/g)) {
				const from = block.byteAt(m.index);
				marks.push({ type: 'mark', from, to: from + m[0].length, class: 'shouting', hover });
			}
			return marks;
		}
	})
});
```

Every position is a document byte. `block.byteAt(i)` turns an offset into `block.text` into one and `block.offsetAt(byte)` goes back. Do the mapping per character rather than adding `block.from`: in a quote, the `> ` markers between the block's lines aren't its text, so `block.from + i` drifts from the second line on. A widget at the end of a line goes at its line break's first byte, `block.byteAt(i)` with `i` where the line's text stops: `block.to` is past the break, so paint there is left out.

| `type` | Fields | What it draws |
| --- | --- | --- |
| `mark` | `from`, `to`, `class`, `attrs?`, `hover?`, `activate?`, `click?` | Your class behind the text from `from` to `to`, one rect per line |
| `widget` | `at`, `view`, `side?`, `data?` | A view between two characters, taking no bytes, drawn after `at` unless `side` is `'before'` |
| `replace` | `from`, `to`, `view?`, `class?`, `data?` | A view, or an empty span with your `class`, standing in for the bytes, which stay in the document |
| `block` | `class?`, `attrs?`, `badge?`, `data?` | Classes and attributes on the block's own element, and a badge view ahead of it |

A view is a `PluginView` that gets `{ paint }`, the paint it came from, so put what it shows in `data`. `svelteView`, `reactView` and `vueView` make one from a component, the same as for any widget, and that's the only place React or Vue shows up: `paint` itself is a plain function. Widgets and replaces land only in prose. Paint that can't land (outside the block's text, past its line ending, on a quote's marker) is left out, with one dev warning per problem.

A block holding other blocks (a list, a quote, a table row, a list item with text in it) never reaches `paint`, since its children get asked about their own text. To class one or give it a badge, add `paintContainer(block)` beside `paint`. It's asked the same way and hands back `block` paint only. Its `text` holds every child's text and its `children` every child, so tell it apart by its type rather than reading either (a 25,000-item list has a lot of both):

```ts
paintContainer(block) {
	return block.is(builtin.blocks.blockquote) ? [{ type: 'block', class: 'quoted' }] : [];
}
```

When something other than the block's bytes changes what you'd paint (an answer arrived, an option flipped), ask again with `editor.repaint(blocks)` from your `setup(editor)`, or `editor.repaint()` for every block on screen. A block that left the document is skipped. The first blocks are asked before `setup` runs, so keep what `paint` reads in the closure `contributes` returns, and call `repaint()` from `setup` if it fills that in. Say your dictionary answers late, with the byte the word it checked starts at:

```ts
setup(editor) {
	return dictionary.onAnswer((at) => {
		const block = editor.blockAt(at);
		if (block) editor.repaint([block]);
	});
}
```

A mark's handlers each get a `MarkAt`: `range`, the mark's bytes in the document as the handler runs, `anchor`, the rect the pointer or the caret is on, and `rects`, every rect the mark paints. `hover` and `activate` work as in [Interactive marks](#interactive-marks-click-hover-and-the-keyboard) below, `hover(null)` included. `click` runs before the caret lands where the press was, and `event.preventDefault()` keeps the caret where it was. Hand the same function over each time you paint: a fresh closure makes every mark look new, and the editor measures it again.

A paint that throws keeps the block's last paint and reports a `PluginError` once, with `doing: 'paint'`, until the block changes or you repaint.

## A whole-document source

A `setup` plugin registers a **source** on each editor instance, from the `onEditor` callback [One process, many editors](per-editor.md) introduces:

```ts
setup(ctx) {
	ctx.onEditor((editor) => {
		const handle = editor.decorations.addSource({
			name: 'my-highlights', // unique per instance; a duplicate throws
			provide: (doc) => scanForMarks(doc) // pure: document in, decorations out
		});
		return () => handle.dispose();
	});
}
```

`provide` receives the document as a `DocumentView` ([Views](../plugin-guide.md#views-what-you-read-what-you-own)) and is **pure over it plus your own state**. The editor re-runs it after every document edit and draws whatever it returns. There's no decoration set to map forward through changes: positions are `(path, offset)` addresses into the current tree, recomputed each run. When your _own_ state changes instead (an option toggled, the selection moved, an async result arrived), call `handle.invalidate()` to re-run just your source.

**Two contracts to build against:**

- **`invalidate()` is synchronous.** Your new decorations are applied before the call returns, so an event handler can invalidate and immediately trust the view. The exception is an `edit` handler, which the editor calls mid-commit: an invalidate from there waits for the commit to finish, so your source reads a finished document rather than a half-applied one. Several of them in one commit are one re-run.
- **A widget that stays put keeps its view.** The renderer matches a `widget` or `replace` by where it sits (and a `replace` by its class too), so a re-run that returns one in the same place hands the view already there the new decoration through `update`, even if the new one names a different `view`. A badge keeps its view while the block's badges keep the same views in the same order. Move it or vary `class` when you want a fresh mount.

## The four decoration types

| Type | Shape | Renders as |
| --- | --- | --- |
| `mark` | `{ type: 'mark', path, start, end, class, attrs?, interactive? }` | A positioned overlay span over the inline range; style it via the class. `interactive` makes it answer clicks, hovers and the keyboard ([Interactive marks](#interactive-marks-click-hover-and-the-keyboard)) |
| `widget` | `{ type: 'widget', path, offset, widget, side? }` | A zero-width atomic inline widget at the offset (ghost text's shape), drawn `'after'` it by default or `'before'` |
| `replace` | `{ type: 'replace', path, start, end, widget?, class? }` | An atomic inline widget covering the range; the hidden bytes stay in the document |
| `block` | `{ type: 'block', path, class?, attrs?, badge? }` | A class/attrs treatment on the whole block (a list item, table row or cell included), plus an optional badge widget (not on a row or cell). Attributes the editor already uses on the block's element (the `data-` names it sets or looks up there, `role`, `tabindex` and friends) get dropped with a dev warning, so pick names of your own |

One `provide` answer using two of them, shapes side by side:

```ts
const pinBadge: PluginView<{ decoration: Decoration }> = (target) => {
	target.textContent = '📌';
	return {};
};

provide: (doc) => [
	{ type: 'mark', path: [2], start: 4, end: 9, class: 'stale-link' }, // bytes 4..9 of block [2]
	{ type: 'block', path: [0], class: 'pinned', badge: { view: pinBadge } }
];
```

Offsets are **raw offsets** into the target block, dimmed markers included, which is the same coordinate space `getContentRange` describes. A `widget`, `replace` widget, or `badge` takes a `DecorationWidgetSpec`, which is `{ view }`: a `PluginView` that draws into an element the editor makes for it and gets `{ decoration }` as its props (the [inline widget](inline-kinds.md#rendering-it-as-a-widget) shape, explained there). Already in Svelte? `svelteView(Component)`, from `@voithos-labs/aragonite/svelte`, makes one from a component, and so do `reactView` and `vueView` from the React and Vue packages ([React and Vue](react-and-vue.md#widgets-decorations-and-menu-rows)). Whatever a widget or badge renders keeps the page's own styles (the editor's reset stops at its edge), so set `box-sizing` yourself if your CSS assumes `border-box`. A mark's handlers live in its `interactive` field, covered at the end of this page; interactive DOM inside a widget is native, so wire your own listeners in your view and drop them in its `destroy`.

All four work in table cells as well as prose blocks. Arrows step over a `widget` or a `replace`; Backspace and Delete treat a `widget` as if it weren't there, and select a `replace` whole before a second press deletes it.

## Recipe: memoize the scan on `editEpoch`

`provide` runs on every document change, so an expensive scan wants a memo. Do **not** key it on `doc.children` identity, because routine typing mutates the tree in place. The second `provide` argument carries `editEpoch`, a counter that bumps once per document change (an edit, or a whole-document `source` replacement) and **never** on `invalidate()`, which is exactly the split a memo needs: epoch miss, the document changed, rescan; epoch hit, only your own state changed, remap the cached scan. The epoch can't tell a keystroke from a swap; the `sourceSwap` event can, since it fires ahead of the swap's epoch.

```ts
let lastEpoch = -1;
let index = new Map<string, MarkDecoration[]>(); // word → its occurrence marks
let caret: EditorSelection | null = null;

const handle = editor.decorations.addSource({
	name: 'occurrences',
	provide: (doc, { editEpoch }) => {
		if (editEpoch !== lastEpoch) {
			lastEpoch = editEpoch;
			index = buildWordIndex(doc); // one whole-document walk per edit
		}
		const word = wordUnderCaret(doc, caret);
		return word ? (index.get(word) ?? []) : []; // one map read per invalidate()
	}
});

editor.events.on('selectionChange', (sel) => {
	caret = sel; // the source's own state, read on the next invalidate
	handle.invalidate();
});
```

Keying the cache on an index (word to marks) rather than a flat list makes the per-invalidate step a map read, not a re-filter of every mark. The bundled `highlight-occurrences` plugin (`@voithos-labs/aragonite-highlight-occurrences`) does the same job as a plugin value, through `paint` ([the plugin unit](../plugin-api.md#the-plugin-unit)): the editor asks only about blocks on screen, so there is no whole-document index to keep.

<details>
<summary>Three more tricks highlight-occurrences pulls, if you're building something like it</summary>

- It paints only blocks of prose (`block.prose`), so a fenced code block's bytes are neither read nor highlighted.
- It keeps each block's word list while that block's text holds, so a caret moving to another word reads no text again, and it asks `editor.repaint()` only when the marked word changes.
- It hides its marks while you type, since a word lighting up under your own caret mid-sentence is maddening. An `edit` whose op is `input` is a keystroke and hides them. Any other op, or a `load`, brings them straight back; otherwise a timer restarted on each key brings them back once you've stopped typing for a quarter second.

</details>

A source that throws is contained: the editor emits an `error` event attributed to your source name and keeps the previous decorations on screen, so a throw never blanks the view.

Pair a source with `editor.rects` when you need geometry (anchor a popup to a decorated range, say): `rects.rangeRects(path, start, end)` returns viewport-space rects for any measurable range, one per visual line (one per cell in a table).

```ts
editor.rects.rangeRects([2], 4, 9); // [DOMRect { x: 96, y: 412, width: 38, height: 22, ... }], one per visual line the range crosses
```

## Interactive marks: click, hover and the keyboard

A mark answers the user through its `interactive` field. It takes up to three handlers, and at least one (an empty `interactive: {}` doesn't compile):

| Handler | Runs when | Gets |
| --- | --- | --- |
| `onClick(dec, ev)` | the mark is clicked, before the caret lands | the click event |
| `onHover(dec, hover)` | the pointer enters the mark, then once more with `null` when the hover's over | `{ anchor, rects }`, in viewport coordinates |
| `onActivate(dec, { anchor })` | the `decorations.activateAtCaret` command runs with the caret in the mark | the mark's rect on the caret's line |

The two pointer handlers differ in one way. A mark with `onClick` takes the click: your handler runs first, then the caret lands where you clicked, unless the handler calls `ev.preventDefault()`, which keeps it where it was. A hover-only mark lets every click, drag and double-click through to the text under it, so a defined word still edits like any other word (and keeps the text cursor). The editor works out the hover from where the pointer is, and it skips that work when no hover mark is on screen.

Here's a glossary: hover a term for its definition, or reach the same popup from the keyboard. `popup` is yours; the editor never sees it.

```ts
const handle = editor.decorations.addSource({
	name: 'glossary',
	provide: (doc) =>
		findTerms(doc).map(({ path, start, end, term }) => ({
			type: 'mark',
			path,
			start,
			end,
			class: 'glossary-term',
			interactive: {
				onHover: (dec, hover) => (hover ? popup.show(term, hover.anchor) : popup.pointerLeft()),
				onActivate: (dec, { anchor }) => popup.show(term, anchor)
			}
		}))
});

// pointer onto "aragonite" in block [3]:
//   onHover(dec, { anchor: DOMRect { x: 212, y: 388, width: 71, height: 20 }, rects: [that same rect] })
// pointer off it:
//   onHover(dec, null)
```

What you can count on:

- **One hover per mark.** A mark that wraps paints one rect per line, and moving between them (across the gap between the lines too) fires nothing. `anchor` is the rect the pointer came in through, and `rects` is all of them.
- **Every hover ends exactly once.** The pointer leaving, your source dropping the mark, its block scrolling out of the rendered range, a new document, the editor unmounting: whichever happens first sends the `null`, and nothing sends a second.
- **`null` means the hover's over, nothing more.** Moving onto your popup counts as leaving too, even where the popup covers another mark, and so does moving onto a menu the editor opens over the text. Whether the popup closes is your call; the usual move is a short grace period so the pointer can travel onto it, and the editor won't time that for you.
- **Only a mouse, or a pen held above the screen, hovers.** A touch never does, and moving with a button down (dragging a selection, say) ends the hover and starts none until the button's up. A plain click leaves the hover alone.
- **Restyling keeps the hover.** A hover belongs to your source, the mark's block and its range, not its class, so an `invalidate()` that adds a `glossary-term-hovered` class doesn't end and restart it. Move the range and it's a new mark (which it is, really). Two hover marks from one source over the same range are told apart by their order in your answer, so swap them mid-hover and the `null` goes to the other one.
- **Throws stay contained.** A handler that throws shows up on the `error` event as origin `decoration`, with the mark's `path`, and the editor carries on.

When marks overlap, the shortest range wins, then the earlier-registered source (a whole-document source before any plugin's paint), then the earlier mark in its answer. The pointer follows the same rule, for hovers and clicks alike.

The keyboard's way in is one command instead of a tab stop per mark. `decorations.activateAtCaret` runs the `onActivate` of the mark under the caret (a caret on either edge counts, and over a selection it's the end you're extending). It ships with no chord. A host binds one through its `keybindings` prop (`{ chord: 'Alt+Enter', command: 'decorations.activateAtCaret' }`), and a plugin that wants its own key wraps it in a command:

```ts
command({
	id: 'lookup',
	title: 'Look up the word',
	chord: 'Alt+L',
	when: (editor) => editor.can('decorations.activateAtCaret'),
	run: (editor) => editor.run('decorations.activateAtCaret')
});
```

The built-in id answers like any other command, which is handy for a host's own button:

```ts
editor.canRunCommand('decorations.activateAtCaret'); // false: no mark with onActivate under the caret
editor.runCommand('decorations.activateAtCaret'); // true: the mark's onActivate ran
```

Off every such mark, `runCommand` answers false as well and runs nothing.
