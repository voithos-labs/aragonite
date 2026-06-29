# Feature: Keyboard table column reorder

Covers moving a table column left/right with `Alt+ArrowLeft` / `Alt+ArrowRight`. The
shortcut acts on the focused cell's column; columns have no fixed header, so every
index is a valid source. Focus follows the moved column.

## Happy paths

- Alt+ArrowRight on a column swaps it past the next column; the source round-trips to the reordered table
- A successful move announces the new 1-based position in the live region ("Moved column to position N of M")

## Edge cases

- Alt+ArrowLeft on the first column is a no-op: the source is unchanged and no undo entry is pushed, so a following Ctrl+Z undoes the prior typing
- A column move on a non-canonical (tight) table canonicalizes the live view, and a single undo restores the original bytes exactly

## Error cases

- A column move keeps container parity (CST vs. DOM) intact and raises no page error
