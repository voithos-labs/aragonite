# Feature: Table block — cell line break (Shift+Enter)

GFM table cells cannot carry raw newlines, so Shift+Enter inserts a literal `<br>` tag at the caret. The cell currently displays the tag as literal text until cells migrate to the inline-render pipeline (see `docs/issues.md`); the byte-level shape and round-trip are still load-bearing.

## Happy paths

- Shift+Enter at the end of a cell's content inserts `<br>` at the caret, and continued typing lands after the tag — source round-trips with `Left<br>Right` inside the cell.
