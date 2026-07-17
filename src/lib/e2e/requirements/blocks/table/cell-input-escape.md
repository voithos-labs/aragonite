# Feature: table cell input escapes pipes

A typed (or IME-composed) `|` inside a table cell must serialize as `\|`, the same
bytes a paste writes. An unescaped pipe splits the row on the next reparse, shifting
or dropping every cell after it — silent data loss on reload.

## Happy paths

- Type `|` at the end of a cell: the cell raw gains `\|`; the neighbor cell is
  untouched.

## User interactions

- Type `x|y` across an existing cell: raw becomes `...x\|y`, caret stays consistent
  so the trailing `y` lands after the escaped pipe, not inside it.

## Edge cases

- Post-reload equivalence: re-parsing the serialized source after typing a pipe
  yields the identical source (no cell shifted or dropped). This is the regression —
  pre-fix the raw held a bare `|`, which reparses to an extra cell and truncates the
  last cell away.
