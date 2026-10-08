# Feature: Keyboard table column reorder

Covers moving a table column left/right with `Alt+ArrowLeft` / `Alt+ArrowRight`. The
shortcut acts on the focused cell's column; columns have no fixed header, so every
index can be moved. Focus follows the moved column.

## Happy paths

- A successful move announces the new 1-based position in the live region ("Moved column to position N of M")

## Edge cases

- A column move on a tight table (no padding in the cells) keeps it tight: the moved cells swap places and nothing gets padded, and a single undo restores the original bytes exactly

## Error cases

- A column move leaves the CST and the DOM in step and raises no page error

## Pinned below the browser

These run the chord in a mounted cell:

- Alt+ArrowRight and Alt+ArrowLeft swap a column past its neighbour in every row (`test/blocks/table/cell-table-chords.test.ts`, `test/editor-actions/table-column-reorder-target.test.ts`); the focused column following the move is `e2e/tests/blocks/table/action-landing.spec.ts`.
- Alt+ArrowLeft in the first column and Alt+ArrowRight in the last do nothing and push no undo entry, so the Ctrl+Z after them takes back the edit before (`test/blocks/table/cell-table-chords.test.ts`).
