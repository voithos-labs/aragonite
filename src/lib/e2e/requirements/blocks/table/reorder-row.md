# Feature: Keyboard table-row reorder (Alt+ArrowUp / Alt+ArrowDown)

Alt+ArrowUp / Alt+ArrowDown inside a table cell moves the focused **body** row
one slot among the table's body rows. The header row is positionally fixed —
the row reorder never touches it and never moves a body row into the header
slot. The move is one undo step, focus follows the row and stays in the same
column, and row/cell identity is preserved across the move.

The chord intercepts before vertical cell navigation (Alt selects reorder over
the plain ArrowUp/ArrowDown caret move).

## Happy paths

- Alt+ArrowDown on an interior body row swaps it past the next body row; focus
  follows and stays in the same column (a marker typed after the move lands in
  that column of the moved row).
- Alt+ArrowUp on an interior body row moves it up one position among body rows.

## Edge cases

- Alt+ArrowUp / Alt+ArrowDown from the header row is a no-op — no source
  mutation (the header is fixed).
- Alt+ArrowUp on the first body row is a no-op AND pushes no undo entry: typing
  then a boundary press then Ctrl+Z restores the _typing_, not a phantom move.
- Alt+ArrowDown on the last body row is a no-op.
- A single undo after a reorder restores the exact pre-move source byte-for-byte.
- Reorder → undo → reorder leaves no container-parity mismatch and logs no page
  error (node identity and per-row state survive the undo round-trip).

## User interactions

- Real keyboard chord (`Alt+ArrowUp` / `Alt+ArrowDown`) inside a focused cell.
- Plain ArrowUp/ArrowDown still navigate the caret between rows; the Alt
  modifier is what selects reorder over navigation.

## Accessibility

- A successful row move updates the polite live region
  (`.editor-sr-live-reorder`) with the row's new position ("Moved row to
  position N of M").
