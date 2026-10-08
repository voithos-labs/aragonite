# Feature: Keyboard table-row reorder (Alt+ArrowUp / Alt+ArrowDown)

Alt+ArrowUp / Alt+ArrowDown inside a table cell moves the focused **body** row
one position among the table's body rows. The header row cannot move: the row
reorder never touches it and never moves a body row into the header's place.
The move is one undo step, focus follows the row and stays in the same column,
and the row and its cells keep their identity across the move.

The chord is handled before vertical cell navigation (Alt chooses reorder over
the plain ArrowUp/ArrowDown caret move).

## Edge cases

- A row move on a tight table (no padding in the cells) keeps every row as it was written, and a
  single undo restores the source byte-for-byte as it was before the move.
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

## Pinned below the browser

These run the chord in a mounted cell, and the second pair also checks the undo stack:

- Alt+ArrowDown and Alt+ArrowUp move an interior body row past its neighbour
  (`test/blocks/table/cell-table-chords.test.ts`, `test/editor-actions/table-row-reorder-target.test.ts`); where the caret lands is `e2e/tests/blocks/table/action-landing.spec.ts`.
- Alt+ArrowUp and Alt+ArrowDown in the header row, Alt+ArrowUp on the first body row and Alt+ArrowDown on the last do nothing and push no undo entry, so the Ctrl+Z after them takes back the edit before (`test/blocks/table/cell-table-chords.test.ts`).
