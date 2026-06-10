# Feature: Table block — cell line break (Shift+Enter)

GFM table cells cannot carry raw newlines, so Shift+Enter inserts a literal `<br>` tag at the caret. The byte-level shape and round-trip are load-bearing; the cell renders the tag as a visible line-break widget (see `cell-inline-rendering.md`).

## Happy paths

- Shift+Enter at the end of a cell's content inserts `<br>` at the caret, and continued typing lands after the tag — source round-trips with `Left<br>Right` inside the cell.
- The inserted `<br>` renders as a visible `.md-br-widget`, never as literal `<br>` cell text.
