# Feature: Keyboard table-row reorder (Alt+ArrowUp / Alt+ArrowDown)

Alt+ArrowUp / Alt+ArrowDown inside a table cell moves the focused **body** row
one position among the table's body rows. The header row cannot move: the row
reorder never touches it and never moves a body row into the header's place.
The move is one undo step, focus follows the row and stays in the same column,
and the row and its cells keep their identity across the move.

The chord is handled before vertical cell navigation (Alt chooses reorder over
the plain ArrowUp/ArrowDown caret move).

## Happy paths

- Alt+ArrowDown on an interior body row swaps it past the next body row; focus
  follows and stays in the same column (a character typed after the move lands in
  that column of the moved row).
- Alt+ArrowUp on an interior body row moves it up one position among body rows.

## Edge cases

- Alt+ArrowUp / Alt+ArrowDown from the header row does nothing: the source is
  unchanged, since the header cannot move.
- Alt+ArrowUp on the first body row does nothing and pushes no undo entry: typing,
  then a press at the boundary, then Ctrl+Z restores the _typing_, not a move that
  never happened.
- Alt+ArrowDown on the last body row does nothing.
- A single undo after a reorder restores the source byte-for-byte as it was before the move.
- Reorder → undo → reorder leaves the CST and the DOM in step and logs no page
  error (node identity and per-row state survive the undo round-trip).

## User interactions

- Real keyboard chord (`Alt+ArrowUp` / `Alt+ArrowDown`) inside a focused cell.
- Plain ArrowUp/ArrowDown still navigate the caret between rows; the Alt
  modifier is what chooses reorder over navigation.

## Accessibility

- A successful row move updates the polite live region
  (`.editor-sr-live-reorder`) with the row's new position ("Moved row to
  position N of M").
