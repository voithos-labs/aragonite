# Decorations

Part of the [plugin guide](../plugin-guide.md). A source registers per editor, from the `onEditor` callback [One process, many editors](per-editor.md) introduces.

Everything so far teaches the editor content you **own**: a kind, its grammar, its component. A decoration is the other half of the story, for annotating content you **don't own**. Highlight every occurrence of a word, ghost-complete a sentence, fold a range, badge a heading. Decorations are view-only: they never enter the document tree, never change `getSource()`, and never touch undo.

You register a **source** on each editor instance, from `onEditor`:

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
- **Widget identity is untracked.** The renderer compares decorations by position and class, not by widget object, so swapping in a new `component` or `buildDom` at the same position with the same class re-renders nothing. Vary `class` when the widget's content changes.

## The four decoration types

| Type      | Shape                                                    | Renders as                                                                                                                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark`    | `{ type: 'mark', path, start, end, class, attrs? }`      | A positioned overlay span over the inline range; style it via the class                                                                                                                                                                                                                                                                       |
| `widget`  | `{ type: 'widget', path, offset, widget, side? }`        | A zero-width atomic inline widget at the offset (ghost text's shape), drawn `'after'` it by default or `'before'`                                                                                                                                                                                                                             |
| `replace` | `{ type: 'replace', path, start, end, widget?, class? }` | An atomic inline widget covering the range; the hidden bytes stay in the document                                                                                                                                                                                                                                                             |
| `block`   | `{ type: 'block', path, class?, attrs?, badge? }`        | A class/attrs treatment on the whole block (a list item, table row or cell included), plus an optional badge widget (not on a row or cell). Attributes the editor already uses on the block's element (the `data-` names it sets or looks up there, `role`, `tabindex` and friends) get dropped with a dev warning, so pick names of your own |

One `provide` answer using two of them, shapes side by side:

```ts
provide: (doc) => [
	{ type: 'mark', path: [2], start: 4, end: 9, class: 'stale-link' }, // bytes 4..9 of block [2]
	{ type: 'block', path: [0], class: 'pinned', badge: { buildDom: () => pinIcon() } }
];
```

Offsets are **raw offsets** into the target block, dimmed markers included, which is the same coordinate space `getContentRange` describes. A `widget`, `replace` widget, or `badge` takes a `DecorationWidgetSpec`: a Svelte `component` (receives the decoration as its prop) or a hand-built `buildDom`. An interactive mark takes `interactive: { onClick }`, not a top-level `onClick`; interactive DOM inside a widget is native, so wire your own listeners in `buildDom`.

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

Keying the cache on an index (word to marks) rather than a flat list makes the per-invalidate step a map read, not a re-filter of every mark. The bundled `highlight-occurrences` plugin (`@voithos-labs/aragonite/plugins/highlight-occurrences`) is this recipe end to end.

<details>
<summary>Three more tricks highlight-occurrences pulls, if you're building something like it</summary>

- It only indexes blocks with inline prose in them (`isProseKind`, the descriptor's `supportsInline`), so a fenced code block's bytes are neither scanned nor highlighted.
- Typing bumps the epoch on every keystroke, so it keeps a second memo: each block's word list, keyed on that block's text. A rebuild re-reads only the block you're typing in.
- It hides its marks while you type, since a word lighting up under your own caret mid-sentence is maddening. A new epoch preceded only by `input` edit events is a keystroke, and the source serves nothing for it. Any other `edit` op, or a `sourceSwap`, brings the marks straight back; otherwise a timer restarted on each `input` brings them back once you've stopped typing for a quarter second.

</details>

A source that throws is contained: the editor emits an `error` event attributed to your source name and keeps the previous decorations on screen, so a throw never blanks the view.

Pair a source with `editor.rects` when you need geometry (anchor a popup to a decorated range, say): `rects.rangeRects(path, start, end)` returns viewport-space rects for any measurable range, one per visual line (one per cell in a table).

```ts
editor.rects.rangeRects([2], 4, 9); // [DOMRect { x: 96, y: 412, width: 38, height: 22, ... }], one per visual line the range crosses
```
