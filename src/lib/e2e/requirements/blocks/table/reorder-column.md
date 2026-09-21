# Feature: Keyboard table column reorder

Covers moving a table column left/right with `Alt+ArrowLeft` / `Alt+ArrowRight`. The
shortcut acts on the focused cell's column; columns have no fixed header, so every
index can be moved. Focus follows the moved column.

## Happy paths

- Alt+ArrowRight on a column swaps it past the next column; the source round-trips to the reordered table
- Alt+ArrowLeft on an interior column swaps it past the previous column; the source round-trips to the reordered table
- Alt+ArrowRight on a column keeps focus in the moved column: a character typed afterward lands in that column's new position
- A successful move announces the new 1-based position in the live region ("Moved column to position N of M")

## Edge cases

- Alt+ArrowLeft on the first column does nothing: the source is unchanged and no undo entry is pushed, so a following Ctrl+Z undoes the typing before it
- Alt+ArrowRight on the last column does nothing at the other end: no change, no undo entry
- A column move on a table whose source is not canonical (tight) canonicalizes the live view, and a single undo restores the original bytes exactly

## Error cases

- A column move leaves the CST and the DOM in step and raises no page error
