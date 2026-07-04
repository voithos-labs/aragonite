# Feature: Table row/column ops (note-taking simulation)

A loaded-ops session over a small loaded table (typed pipe syntax stays a
paragraph in the live tree, so an interactive table only exists by loading).
Tables are the most state-desync-prone block kind — a keyed container whose
rows are themselves keyed sub-containers — and the simulation's continuous
round-trip + nested-state oracles are the project's only net for silent
corruption there. The session drives the full row/column gesture vocabulary
and re-checks both oracles after every move, leading with a column op (the
one edit that touches every row at once) and closing with an undo of a
column delete, the two richest stressors.

## Happy paths

- inserting a column adds an empty cell to every row, header included — the
  visible column count grows by one across the whole table
- typing into the freshly inserted header cell lands in that cell and
  round-trips
- inserting a body row below an existing row, then deleting it, returns the
  table to its prior shape without disturbing the other rows
- deleting the middle column narrows every row at once

## Edge cases

- undo after the column delete restores the column across every row in one
  step — the whole-table rewrite that swaps every row's identity, so the
  nested state must follow or silently desync

## User interactions

- every op is a real pointer click into the target cell followed by the
  table keyboard shortcut (insert/delete column, insert/delete row); the
  session settles on the source actually changing before the next move

## Error cases

- no console, page, or structured editor error fires across the whole session
- the live serializer round-trips the current CST after every insert, edit,
  delete, and undo
- the nested-state audit finds no desync after any move — including the
  column-delete undo that rebuilds every row
