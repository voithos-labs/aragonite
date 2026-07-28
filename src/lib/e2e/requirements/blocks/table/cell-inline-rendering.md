# Feature: table cell inline rendering

Cells run their content through the same inline-render pipeline as prose
blocks (emphasis, code spans, links, strikethrough, the `<br>` widget),
inheriting reference resolution and LRD-signature re-render correctness.
Images stay alt-text inside cells (no widget). Editing, boundary navigation,
and Tab cell-exit stay correct in widget-bearing cells, where a widget
contributes zero `textContent` but several raw bytes.

## Happy paths

- emphasis in a cell: `*x*` renders an `<em>` containing `x` with dimmed `*` markers
- strong in a cell: `**x**` renders a `<strong>` containing `x`
- code span in a cell: `` `x` `` renders a `<code class="inline-code-content">` containing `x`
- strikethrough in a cell: `~~x~~` renders an `<s>` containing `x`
- inline link in a cell: `[t](u)` renders an `<a class="md-link-content" href="u">` containing `t`
- reference link in a cell resolves: `[t][r]` with an LRD `[r]: u` renders an `<a href="u">`

## Edge cases

- escaped pipe in a cell: `b \| c` renders with a dimmed `\` marker and the cell's
  textContent stays `b \| c` (the escape node renders marker + literal `|`)
- image in a cell stays alt-text: `![a](u)` renders the alt text `a`, no `<img>` / widget
- image in a cell under reading mode: both marker spans hide, leaving the alt as the
  cell's only painted text, and the bytes stay in the DOM (regression: the fallback's
  split is what a marker collapse acts on — a single unsplit span leaves the whole
  source painted, or nothing at all)
- empty cell renders without leftover markup and stays focusable
- a cell with only a `<br>` widget renders the widget and nothing else

## User interactions

- Shift+Enter inserting a `<br>` and rendering it as a widget: covered by
  `cell-line-break.md` / `cell-line-break.spec.ts`
- typing at the very end of a widget-bearing cell (Ctrl+End) appends to raw after the
  widget's bytes (widget contributes 0 textContent but N raw bytes — offsets must not
  undercount)
- typing at the end of the first visual line (End stays before a trailing widget)
  splices before the widget's raw bytes — offsets must not overcount either
- ArrowRight at the very end of a widget-bearing cell (Ctrl+End) exits to the next
  cell, not mid-cell
- Tab from a widget-bearing cell moves to the next cell
- editing an LRD's URL in-editor updates an unedited reference cell's rendered `href`
  (inherits the LRD signature-keyed re-render)
