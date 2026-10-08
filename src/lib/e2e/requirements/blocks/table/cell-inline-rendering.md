# Feature: table cell inline rendering

Cells run their content through the same inline-render pipeline as prose
blocks (emphasis, code spans, links, strikethrough, the `<br>` widget),
inheriting reference resolution and LRD-signature re-render correctness.
Images stay alt-text inside cells (no widget). Editing, boundary navigation,
and Tab cell-exit stay correct in widget-bearing cells, where a widget
contributes zero `textContent` but several raw bytes.

## Happy paths

- reference link in a cell resolves: `[t][r]` with an LRD `[r]: u` renders an `<a href="u">`

## Edge cases

- escaped pipe in a cell: `b \| c` renders with a dimmed `\` marker and the cell's
  textContent stays `b \| c` (the escape node renders marker + literal `|`)
- image in a cell under reading mode: both marker spans hide, leaving the alt as the
  cell's only painted text, and the bytes stay in the DOM (a regression test: hiding a
  marker acts on the split the fallback makes, so a single unsplit span leaves the whole
  source painted, or nothing at all)
- empty cell renders without leftover markup and stays focusable
- a cell with only a `<br>` widget renders the widget and nothing else

## User interactions

- Shift+Enter inserting a `<br>` and rendering it as a widget: covered by
  `cell-line-break.md` / `cell-line-break.spec.ts`
- typing at the very end of a widget-bearing cell (Ctrl+End) appends to raw after the
  widget's bytes (a widget contributes 0 textContent but N raw bytes, so the offsets must
  not undercount)
- typing at the end of the first visual line (End stays before a trailing widget)
  splices before the widget's raw bytes, so the offsets must not overcount either
- arrowing across a mid-cell `<br>` keeps focus on a cell rather than leaving it on an
  element that is not a cell (the browser's own contenteditable carries the caret; the keys
  never reach the caret-edge dispatch)
- Backspace at a mid-cell `<br>`'s trailing edge deletes the whole tag on one press and
  keeps focus on the cell. The prose model this widget kind inherits is
  select-then-delete, which needs a selection overlay a cell does not paint, so it
  showed nothing on press 1 and deleted a byte that was not adjacent on press 2. An image at
  the same edge is untouched by this rule: a cell renders it as source text, not a widget
- ArrowRight at the very end of a widget-bearing cell (Ctrl+End) exits to the next
  cell, not mid-cell
- Tab from a widget-bearing cell moves to the next cell
- editing an LRD's URL in-editor updates an unedited reference cell's rendered `href`
  (inherits the LRD signature-keyed re-render)

## Pinned below the browser

The cell hands its bytes to the same inline renderer a paragraph uses, so these run on a mounted cell:

- `*x*`, `**x**`, a code span, `~~x~~` and an inline link render one `<em>`, `<strong>`, `<code class="inline-code-content">`, `<s>` and `<a class="md-link-content" href="u">` holding `x`, with dimmed markers (`test/blocks/table/cell-render.test.ts`).
- An image stays its own source text in a cell, never an `<img>` or a widget, with its two markers split from the alt (`test/blocks/table/cell-render.test.ts`).
