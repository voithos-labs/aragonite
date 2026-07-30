# Feature: Table block — cell line break (Shift+Enter)

GFM table cells cannot carry raw newlines, so Shift+Enter inserts a literal `<br>` tag at the caret. The byte-level shape and round-trip are load-bearing; the cell renders the tag as a visible line-break widget (see `cell-inline-rendering.md`).

## Happy paths

- Shift+Enter at the end of a cell's content inserts `<br>` at the caret, and continued typing lands after the tag — source round-trips with `Left<br>Right` inside the cell.
- The inserted `<br>` renders as a visible `.md-br-widget`, never as literal `<br>` cell text.

## Edge cases

- Backspace at the caret-adjacent edge of a rendered `<br>` removes the whole tag on the FIRST
  press, leaving the characters on either side untouched. A cell paints no widget-selection
  overlay, so the prose select-then-delete model showed nothing between two presses and the
  second press deleted a non-adjacent byte.
- A plain arrow at that same edge steps the caret across the widget and deletes nothing — the
  navigation twin of the rule above.
